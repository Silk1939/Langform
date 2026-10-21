import Foundation
import CryptoKit
import Combine
import SwiftUI

enum GemmaModelError: LocalizedError {
    case missing
    case unavailable(String)
    case http(Int)
    case wrongSize(expected: Int64, actual: Int64)
    case wrongChecksum
    case fileChanged

    var errorDescription: String? {
        switch self {
        case .missing: return "Lade Gemma zuerst einmal in den KI-Einstellungen herunter."
        case .unavailable(let reason): return reason
        case .http(let code): return "Das Modell konnte nicht geladen werden (HTTP \(code)). Bitte versuche es später erneut."
        case .wrongSize: return "Die Modelldatei ist unvollständig. Bitte lade sie erneut."
        case .wrongChecksum: return "Die Modelldatei hat die Integritätsprüfung nicht bestanden. Bitte lade sie erneut."
        case .fileChanged: return "Die Modelldatei wurde während der Prüfung verändert. Bitte versuche es erneut."
        }
    }
}

/// Small, independently testable file contract. Hashes chunks rather than loading
/// the model weights into memory. Call from a utility task, never the UI actor.
enum GemmaModelFileValidator {
    struct Stamp: Codable, Equatable, Sendable {
        let size: Int64
        let modified: Date
        let created: Date
        let inode: UInt64
        let device: UInt64
    }

    static func stamp(for url: URL) throws -> Stamp {
        guard FileManager.default.fileExists(atPath: url.path) else { throw GemmaModelError.missing }
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        guard attributes[.type] as? FileAttributeType == .typeRegular,
              let size = attributes[.size] as? NSNumber,
              let modified = attributes[.modificationDate] as? Date,
              let created = attributes[.creationDate] as? Date,
              let inode = attributes[.systemFileNumber] as? NSNumber,
              let device = attributes[.systemNumber] as? NSNumber else {
            throw GemmaModelError.unavailable("Die gespeicherte Modelldatei kann nicht gelesen werden.")
        }
        return Stamp(size: size.int64Value, modified: modified, created: created,
                     inode: inode.uint64Value, device: device.uint64Value)
    }

    @discardableResult
    static func validate(_ url: URL, expectedBytes: Int64, expectedSHA256: String,
                         checkCancellation: () throws -> Void = { try Task.checkCancellation() }) throws -> Stamp {
        try checkCancellation()
        let before = try stamp(for: url)
        guard before.size == expectedBytes else {
            throw GemmaModelError.wrongSize(expected: expectedBytes, actual: before.size)
        }
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hash = SHA256()
        var bytes: Int64 = 0
        while true {
            // Foundation can autorelease the backing NSData. A detached task
            // has no per-iteration pool, so release both the read buffer and
            // its bridged storage before allocating the next chunk.
            let hasChunk = try autoreleasepool { () throws -> Bool in
                try checkCancellation()
                guard let data = try handle.read(upToCount: 4 * 1_024 * 1_024), !data.isEmpty else { return false }
                bytes += Int64(data.count)
                guard bytes <= expectedBytes else { throw GemmaModelError.fileChanged }
                hash.update(data: data)
                return true
            }
            if !hasChunk { break }
        }
        try checkCancellation()
        guard bytes == expectedBytes, try stamp(for: url) == before else { throw GemmaModelError.fileChanged }
        let digest = hash.finalize().map { String(format: "%02x", $0) }.joined()
        guard digest == expectedSHA256.lowercased() else { throw GemmaModelError.wrongChecksum }
        return before
    }

    /// A terminated process can leave a fully transferred, unverified staging
    /// file. Remove only the exact UUID.pending files owned by this downloader;
    /// never touch a promoted model, receipt, directory or unrelated file.
    static func removeAbandonedDownloads(in directory: URL, keeping: Set<String> = []) throws {
        for candidate in try FileManager.default.contentsOfDirectory(at: directory,
            includingPropertiesForKeys: nil, options: [.skipsHiddenFiles]) {
            guard candidate.pathExtension == "pending",
                  UUID(uuidString: candidate.deletingPathExtension().lastPathComponent) != nil,
                  !keeping.contains(candidate.lastPathComponent) else { continue }
            let attributes = try FileManager.default.attributesOfItem(atPath: candidate.path)
            guard attributes[.type] as? FileAttributeType == .typeRegular else { continue }
            try FileManager.default.removeItem(at: candidate)
        }
    }
}

@MainActor
final class GemmaModelStore: ObservableObject {
    static let shared = GemmaModelStore()
    nonisolated static let modelName = "Gemma 4 E4B"
    // Metal pipeline creation aborts inside the driver on the verified phone.
    // Select CPU before native creation; an abort cannot be caught in Swift.
    nonisolated static let runtimeBackend = "cpu"
    // This exact, SHA-validated older artifact omits context metadata; its
    // official model card documents 32K. Limit the iPhone allocation to 8K;
    // a longer full source fails its exact token check instead of being cut.
    nonisolated static let verifiedContextTokens: Int? = 8_192
    nonisolated static let revision = "2eee7ac325f20eb8c9ac1d0e972f7c84663062da"
    nonisolated static let expectedSHA256 = "0b2a8980ce155fd97673d8e820b4d29d9c7d99b8fa6806f425d969b145bd52e0"
    nonisolated static let expectedBytes: Int64 = 3_659_530_240
    nonisolated static let providerIdentity = "gemma-4-E4B-it-litert-lm@" + revision + ":sha256:" + expectedSHA256
    nonisolated static let downloadURL = URL(string: "https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/" + revision + "/gemma-4-E4B-it.litertlm")!
    nonisolated static let localModelURL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("GemmaModels", isDirectory: true)
        .appendingPathComponent("gemma-4-E4B-2eee7ac325f2", isDirectory: true)
        .appendingPathComponent("gemma-4-E4B-it.litertlm")

    enum Status: Equatable {
        case missing
        case checking
        case downloading(received: Int64, total: Int64)
        case ready
        case error(String)
    }

    @Published private(set) var status: Status = .missing
    private var downloadTask: Task<Void, Never>?
    private var downloadID: UUID?
    private var validationTask: Task<GemmaModelFileValidator.Stamp, Error>?
    private var validatedStamp: GemmaModelFileValidator.Stamp?

    var isDownloading: Bool { downloadTask != nil }
    var isBusy: Bool { isDownloading || status == .checking }

    private struct Receipt: Codable, Sendable {
        let identity: String
        let stamp: GemmaModelFileValidator.Stamp
    }

    nonisolated private static var directory: URL { localModelURL.deletingLastPathComponent() }
    nonisolated private static var receiptURL: URL { directory.appendingPathComponent("validated.json") }

    /// No network activity. A receipt is reused only for the exact model and
    /// unchanged file metadata; a sideloaded/replaced file is hashed in full.
    func validatedURL() async throws -> URL {
        guard downloadTask == nil else {
            throw GemmaModelError.unavailable("Gemma wird noch heruntergeladen. Bitte warte bis zur Prüfung.")
        }
        if let validationTask {
            _ = try await validationTask.value
            return Self.localModelURL
        }
        let knownStamp = validatedStamp
        status = .checking
        let task = Task.detached(priority: .utility) {
            try Task.checkCancellation()
            try Self.prepareDirectory()
            try GemmaModelFileValidator.removeAbandonedDownloads(in: Self.directory)
            let current = try GemmaModelFileValidator.stamp(for: Self.localModelURL)
            guard current.size == Self.expectedBytes else {
                throw GemmaModelError.wrongSize(expected: Self.expectedBytes, actual: current.size)
            }
            try Self.protect(Self.localModelURL)
            if current == knownStamp { return current }
            if let data = try? Data(contentsOf: Self.receiptURL),
               let receipt = try? JSONDecoder().decode(Receipt.self, from: data),
               receipt.identity == Self.providerIdentity, receipt.stamp == current {
                return current
            }
            let checked = try GemmaModelFileValidator.validate(Self.localModelURL,
                expectedBytes: Self.expectedBytes, expectedSHA256: Self.expectedSHA256)
            try Self.prepareDirectory()
            let receipt = Receipt(identity: Self.providerIdentity, stamp: checked)
            try JSONEncoder().encode(receipt).write(to: Self.receiptURL, options: .atomic)
            try Self.protect(Self.receiptURL)
            return checked
        }
        validationTask = task
        do {
            let stamp = try await withTaskCancellationHandler { try await task.value }
                onCancel: { task.cancel() }
            try Task.checkCancellation()
            validatedStamp = stamp
            validationTask = nil
            status = .ready
            return Self.localModelURL
        } catch {
            validationTask = nil
            validatedStamp = nil
            if case GemmaModelError.missing = error { status = .missing }
            else if error is CancellationError { status = .missing }
            else { status = .error(error.localizedDescription) }
            throw error
        }
    }

    func refresh() async {
        guard downloadTask == nil else { return }
        _ = try? await validatedURL()
    }

    /// Only an explicit user action calls this method. The temporary transfer is
    /// invisible to inference; the final filename appears only after validation.
    func download() async {
        guard downloadTask == nil, validationTask == nil else { return }
        let id = UUID()
        downloadID = id
        status = .downloading(received: 0, total: Self.expectedBytes)
        let task = Task { await self.performDownload(id: id) }
        downloadTask = task
        await withTaskCancellationHandler { await task.value } onCancel: { task.cancel() }
    }

    func cancelDownload() { downloadTask?.cancel() }

    private func performDownload(id: UUID) async {
        let pending = Self.directory.appendingPathComponent("\(id.uuidString).pending")
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 120
        configuration.timeoutIntervalForResource = 6 * 60 * 60
        configuration.allowsCellularAccess = false
        configuration.allowsExpensiveNetworkAccess = false
        configuration.allowsConstrainedNetworkAccess = false
        let session = URLSession(configuration: configuration)
        let delegate = GemmaTransferProgress(expectedBytes: Self.expectedBytes) { [weak self] received in
            Task { @MainActor in
                guard let self, self.downloadID == id, self.downloadTask?.isCancelled == false,
                      case .downloading = self.status else { return }
                self.status = .downloading(received: received, total: Self.expectedBytes)
            }
        }
        defer {
            session.invalidateAndCancel()
            try? FileManager.default.removeItem(at: pending)
        }
        do {
            try await Task.detached(priority: .utility) {
                try Task.checkCancellation()
                try Self.prepareDirectory()
                try GemmaModelFileValidator.removeAbandonedDownloads(in: Self.directory,
                    keeping: [pending.lastPathComponent])
                let space = try Self.directory.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
                if let available = space.volumeAvailableCapacityForImportantUsage,
                   available < Self.expectedBytes + 256 * 1_024 * 1_024 {
                    let required = ByteCountFormatter.string(fromByteCount: Self.expectedBytes + 256 * 1_024 * 1_024, countStyle: .decimal)
                    throw GemmaModelError.unavailable("Für Gemma werden etwa \(required) freier Speicher benötigt.")
                }
            }.value
            try Task.checkCancellation()
            var request = URLRequest(url: Self.downloadURL)
            request.cachePolicy = .reloadIgnoringLocalCacheData
            let (temporaryURL, response) = try await session.download(for: request, delegate: delegate)
            defer { try? FileManager.default.removeItem(at: temporaryURL) }
            try Task.checkCancellation()
            guard let http = response as? HTTPURLResponse else {
                throw GemmaModelError.unavailable("Der Modellserver hat keine gültige Antwort gesendet.")
            }
            guard http.statusCode == 200 else { throw GemmaModelError.http(http.statusCode) }
            guard http.url?.scheme?.lowercased() == "https" else {
                throw GemmaModelError.unavailable("Das Modell benötigt eine sichere HTTPS-Verbindung.")
            }
            try FileManager.default.moveItem(at: temporaryURL, to: pending)
            try Self.protect(pending)
            status = .checking
            let validation = Task.detached(priority: .utility) {
                try GemmaModelFileValidator.validate(pending, expectedBytes: Self.expectedBytes,
                                                    expectedSHA256: Self.expectedSHA256)
            }
            _ = try await withTaskCancellationHandler { try await validation.value }
                onCancel: { validation.cancel() }
            try Task.checkCancellation()
            // rename on the same volume atomically replaces any corrupt prior file.
            if FileManager.default.fileExists(atPath: Self.localModelURL.path) {
                _ = try FileManager.default.replaceItemAt(Self.localModelURL, withItemAt: pending)
            } else {
                try FileManager.default.moveItem(at: pending, to: Self.localModelURL)
            }
            try Self.protect(Self.localModelURL)
            let promotedStamp = try GemmaModelFileValidator.stamp(for: Self.localModelURL)
            validatedStamp = promotedStamp
            let receipt = Receipt(identity: Self.providerIdentity, stamp: promotedStamp)
            try JSONEncoder().encode(receipt).write(to: Self.receiptURL, options: .atomic)
            try Self.protect(Self.receiptURL)
            finishDownload(id: id, status: .ready)
        } catch is CancellationError {
            finishDownload(id: id, status: .missing)
        } catch let error as URLError where error.code == .cancelled {
            if let actual = delegate.oversizedBytes {
                finishDownload(id: id, status: .error(GemmaModelError.wrongSize(expected: Self.expectedBytes, actual: actual).localizedDescription))
            } else { finishDownload(id: id, status: .missing) }
        } catch {
            finishDownload(id: id, status: .error(error.localizedDescription))
        }
    }

    private func finishDownload(id: UUID, status terminalStatus: Status) {
        guard downloadID == id else { return }
        // Publish the terminal status only after clearing its active task.
        // The setup view can immediately enable Retry/Download again.
        downloadTask = nil
        downloadID = nil
        status = terminalStatus
    }

    nonisolated private static func prepareDirectory() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try protect(directory)
    }

    nonisolated private static func protect(_ url: URL) throws {
        var protectedURL = url
        var resources = URLResourceValues()
        resources.isExcludedFromBackup = true
        try protectedURL.setResourceValues(resources)
        #if os(iOS)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                                              ofItemAtPath: url.path)
        #endif
    }
}

private final class GemmaTransferProgress: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    private let expectedBytes: Int64
    private let progress: @Sendable (Int64) -> Void
    private let lock = NSLock()
    private var oversized: Int64?
    private var lastUpdate: TimeInterval = 0

    var oversizedBytes: Int64? { lock.withLock { oversized } }

    init(expectedBytes: Int64, progress: @escaping @Sendable (Int64) -> Void) {
        self.expectedBytes = expectedBytes
        self.progress = progress
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didWriteData bytesWritten: Int64, totalBytesWritten: Int64,
                    totalBytesExpectedToWrite: Int64) {
        if totalBytesWritten > expectedBytes || totalBytesExpectedToWrite > expectedBytes {
            lock.withLock { oversized = max(totalBytesWritten, totalBytesExpectedToWrite) }
            downloadTask.cancel()
            return
        }
        let now = Date.timeIntervalSinceReferenceDate
        guard now - lastUpdate >= 0.2 || totalBytesWritten == expectedBytes else { return }
        lastUpdate = now
        progress(totalBytesWritten)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(request.url?.scheme?.lowercased() == "https" ? request : nil)
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didFinishDownloadingTo location: URL) {}
}

#if os(iOS)
struct GemmaModelSetupView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var store: GemmaModelStore

    @MainActor init(store: GemmaModelStore? = nil) { self.store = store ?? .shared }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(GemmaModelStore.modelName).font(.headline)
                    Text("Das Google-Modell wird einmal per WLAN geladen: etwa 3,7 GB. Danach entstehen Kurzfassungen auf deinem iPhone, ohne KI-API-Gebühren. Untertitel bleiben auf dem Gerät.")
                    statusContent
                }
                Section {
                    Link("Modell und Nutzungsbedingungen", destination: URL(string: "https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm")!)
                    Link("Google Gemma", destination: URL(string: "https://ai.google.dev/gemma")!)
                } footer: {
                    Text("Das Modell benötigt zusätzlich freien Arbeitsspeicher. Geschwindigkeit und Verfügbarkeit hängen vom iPhone und vom Video ab.")
                }
            }
            .navigationTitle("Lokale KI")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Schließen") { dismiss() } } }
            .task { await store.refresh() }
        }
    }

    @ViewBuilder private var statusContent: some View {
        switch store.status {
        case .missing:
            Text("Noch nicht auf diesem iPhone.").foregroundStyle(.secondary)
            downloadButton("Gemma herunterladen")
        case .checking:
            ProgressView("Modelldatei wird geprüft …")
            if store.isDownloading { Button("Abbrechen", role: .cancel) { store.cancelDownload() } }
        case .downloading(let received, let total):
            ProgressView(value: Double(received), total: Double(total))
                .accessibilityLabel("Gemma wird heruntergeladen")
            Text("\(ByteCountFormatter.string(fromByteCount: received, countStyle: .decimal)) von \(ByteCountFormatter.string(fromByteCount: total, countStyle: .decimal))")
                .font(.caption).foregroundStyle(.secondary)
            Text("Langform während des Downloads geöffnet lassen.").font(.caption).foregroundStyle(.secondary)
            Button("Download abbrechen", role: .cancel) { store.cancelDownload() }
        case .ready:
            Label("Gemma ist auf diesem iPhone bereit", systemImage: "checkmark.circle.fill")
                .foregroundStyle(.green)
        case .error(let message):
            Text(message).foregroundStyle(.secondary)
            downloadButton("Erneut herunterladen")
        }
    }

    private func downloadButton(_ title: String) -> some View {
        Button(title) { Task { await store.download() } }
            .disabled(store.isBusy)
    }
}
#endif
