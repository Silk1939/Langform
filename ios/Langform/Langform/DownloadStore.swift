import Foundation
import Combine
import AVFoundation
import UIKit

/// Background URLSession owns the transfer; this object owns durable metadata
/// and the final local file. Downloads never depend on an open WKWebView.
final class DownloadStore: NSObject, ObservableObject, URLSessionDownloadDelegate {
    static let shared = DownloadStore()
    static let sessionIdentifier = "de.ipekkaya.langform.video-downloads.v1"
    @Published private(set) var items: [OfflineDownload] = []
    @Published private(set) var libraryError: String?
    @Published var allowCellular = UserDefaults.standard.bool(forKey: "langform.downloads.allowCellular") {
        didSet { UserDefaults.standard.set(allowCellular, forKey: "langform.downloads.allowCellular") }
    }
    private let directory: URL
    private var libraryAvailable = true
    private var backgroundCompletion: (() -> Void)?
    private var eventsFinished = false
    private var validations = Set<UUID>()
    private var progressTimes: [UUID: TimeInterval] = [:]
    // Reservations account for other transfers whose bytes have not reached
    // disk yet. Import copies use the same budget from their file queue.
    private let reservationLock = NSLock()
    private var spaceReservations: [UUID: Int64] = [:]
    private let fileQueue = DispatchQueue(label: "de.ipekkaya.langform.download-files", qos: .utility)
    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.background(withIdentifier: Self.sessionIdentifier)
        configuration.sessionSendsLaunchEvents = true
        configuration.isDiscretionary = false
        configuration.waitsForConnectivity = true
        configuration.timeoutIntervalForResource = 6 * 60 * 60
        configuration.httpMaximumConnectionsPerHost = 2
        configuration.urlCache = nil
        // Each user-started request sets its own Wi-Fi/mobile policy.
        configuration.allowsCellularAccess = true
        configuration.allowsExpensiveNetworkAccess = true
        configuration.allowsConstrainedNetworkAccess = false
        return URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
    }()

    override init() {
        directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("OfflineVideos", isDirectory: true)
        super.init()
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                    attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
            var excludedDirectory = directory
            var values = URLResourceValues(); values.isExcludedFromBackup = true
            try excludedDirectory.setResourceValues(values)
            if FileManager.default.fileExists(atPath: manifest.path) {
                let restored = try JSONDecoder().decode([OfflineDownload].self, from: Data(contentsOf: manifest))
                guard Set(restored.map(\.id)).count == restored.count,
                      restored.allSatisfy({ $0.receivedBytes >= 0 && $0.receivedBytes <= DownloadSourcePolicy.maximumBytes
                          && $0.expectedBytes >= 0 && $0.expectedBytes <= DownloadSourcePolicy.maximumBytes }) else {
                    throw DownloadSourceError.unsupported("Die gespeicherte Downloadliste ist beschädigt.")
                }
                items = restored
            }
        } catch {
            libraryAvailable = false
            libraryError = "Die Offlinebibliothek konnte nicht geöffnet werden: \(error.localizedDescription)"
        }
        if libraryAvailable {
            for item in items where item.status == .downloading {
                spaceReservations[item.id] = max(0, max(10 * 1_024 * 1_024, item.expectedBytes) - item.receivedBytes)
            }
            reconnect()
        }
    }

    private var manifest: URL { directory.appendingPathComponent("library.json") }
    var usedBytes: Int64 { items.filter { $0.status == .ready }.reduce(0) { $0 + $1.receivedBytes } }
    var activeCount: Int { items.filter(\.isActive).count }

    func fileURL(for item: OfflineDownload) -> URL? {
        guard item.status == .ready, let name = item.fileName,
              name == item.id.uuidString + ".mp4" || name == item.id.uuidString + ".mov",
              FileManager.default.fileExists(atPath: directory.appendingPathComponent(name).path) else { return nil }
        return directory.appendingPathComponent(name)
    }

    @discardableResult
    func start(_ source: DownloadSource) throws -> UUID {
        try DownloadSourcePolicy.validate(source)
        guard libraryAvailable else { throw DownloadSourceError.unsupported(libraryError ?? "Die Offlinebibliothek ist gerade nicht verfügbar.") }
        guard !items.contains(where: { $0.isActive && $0.source?.videoID == source.videoID && source.videoID != nil }) else {
            throw DownloadSourceError.unsupported("Dieses Video wird bereits heruntergeladen.")
        }
        let item = OfflineDownload(id: UUID(), title: source.title, source: source, createdAt: Date(),
                                   status: .downloading, expectedBytes: source.expectedBytes)
        try reserveSpace(id: item.id, required: max(10 * 1_024 * 1_024, source.expectedBytes))
        items.insert(item, at: 0)
        guard persist() else { items.removeAll { $0.id == item.id }; releaseSpace(item.id); throw DownloadSourceError.unsupported(libraryError ?? "Die Offlinebibliothek konnte nicht gespeichert werden.") }
        var request = URLRequest(url: source.url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        if source.origin == .activeWatch {
            request.setValue(source.userAgent, forHTTPHeaderField: "User-Agent")
            request.setValue(source.pageURL?.absoluteString, forHTTPHeaderField: "Referer")
        }
        request.timeoutInterval = 60
        request.allowsCellularAccess = allowCellular
        request.allowsExpensiveNetworkAccess = allowCellular
        request.allowsConstrainedNetworkAccess = false
        let task = session.downloadTask(with: request)
        task.taskDescription = item.id.uuidString
        task.resume()
        return item.id
    }

    func retry(_ item: OfflineDownload) throws {
        guard !item.isActive, let source = item.source else { return }
        // Never silently reuse an expired signed URL or replace it with a guessed
        // URL. The watch view must supply a fresh matching source in that case.
        try DownloadSourcePolicy.validate(source)
        _ = try start(source)
        remove(item)
    }

    func cancel(_ item: OfflineDownload) {
        // A SwiftUI action may carry the validating snapshot after its file
        // has already become ready. Never discard that completed state.
        guard items.contains(where: { $0.id == item.id && $0.isActive }) else { return }
        releaseSpace(item.id)
        progressTimes.removeValue(forKey: item.id)
        update(item.id) { $0.status = .cancelled; $0.errorMessage = nil }
        session.getAllTasks { tasks in tasks.filter { $0.taskDescription == item.id.uuidString }.forEach { $0.cancel() } }
        _ = persist()
    }

    func remove(_ item: OfflineDownload) {
        if item.isActive { cancel(item) }
        releaseSpace(item.id)
        // Only UUID-derived owned paths can be removed; manifest input is never
        // used as an arbitrary filesystem path.
        do {
            for suffix in [".mp4", ".mov", ".pending.mp4", ".pending.mov"] {
                let path = directory.appendingPathComponent(item.id.uuidString + suffix)
                if FileManager.default.fileExists(atPath: path.path) { try FileManager.default.removeItem(at: path) }
            }
        } catch { libraryError = "Der Download konnte nicht gelöscht werden: \(error.localizedDescription)"; return }
        items.removeAll { $0.id == item.id }
        _ = persist()
    }

    func importFile(_ source: URL) {
        guard libraryAvailable else { return }
        let id = UUID(), ext = source.pathExtension.lowercased() == "mov" ? "mov" : "mp4"
        let pending = directory.appendingPathComponent(id.uuidString + ".pending." + ext)
        items.insert(OfflineDownload(id: id, title: String(source.deletingPathExtension().lastPathComponent.prefix(300)),
                                     source: nil, createdAt: Date(), status: .validating), at: 0)
        guard persist() else { items.removeAll { $0.id == id }; return }
        validations.insert(id)
        fileQueue.async { [weak self] in
            let scoped = source.startAccessingSecurityScopedResource()
            defer { if scoped { source.stopAccessingSecurityScopedResource() } }
            do {
                let bytes = (try FileManager.default.attributesOfItem(atPath: source.path)[.size] as? NSNumber)?.int64Value ?? 0
                guard bytes > 0 else { throw DownloadSourceError.invalidFile }
                guard bytes <= DownloadSourcePolicy.maximumBytes else { throw DownloadSourceError.tooLarge }
                try self?.reserveSpace(id: id, required: bytes)
                try FileManager.default.copyItem(at: source, to: pending)
                self?.releaseSpace(id)
                try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: pending.path)
                DispatchQueue.main.async { [weak self] in self?.validateFile(pending, id: id, expectedBytes: bytes, ext: ext) }
            } catch {
                self?.releaseSpace(id)
                DispatchQueue.main.async { [weak self] in
                    try? FileManager.default.removeItem(at: pending)
                    self?.fail(id, message: error.localizedDescription)
                    self?.validationFinished(id)
                }
            }
        }
    }

    private func reconnect() {
        let restoredIDs = Set(items.map(\.id))
        session.getAllTasks { [weak self] tasks in
            DispatchQueue.main.async {
                guard let self else { return }
                let activeIDs = Set(tasks.compactMap { $0.taskDescription }.compactMap(UUID.init(uuidString:)))
                for index in self.items.indices {
                    let item = self.items[index]
                    guard restoredIDs.contains(item.id) else { continue }
                    if item.status == .ready && self.fileURL(for: item) == nil {
                        self.items[index].status = .failed
                        self.items[index].fileName = nil
                        self.items[index].errorMessage = "Die lokale Videodatei fehlt. Lade das Video erneut herunter."
                    } else if item.isActive && !activeIDs.contains(item.id) && !self.validations.contains(item.id) {
                        let pendingMP4 = self.directory.appendingPathComponent(item.id.uuidString + ".pending.mp4")
                        let pendingMOV = self.directory.appendingPathComponent(item.id.uuidString + ".pending.mov")
                        if FileManager.default.fileExists(atPath: pendingMP4.path) {
                            self.validateFile(pendingMP4, id: item.id, expectedBytes: item.expectedBytes)
                        } else if FileManager.default.fileExists(atPath: pendingMOV.path) {
                            self.validateFile(pendingMOV, id: item.id, expectedBytes: item.expectedBytes, ext: "mov")
                        } else if let ext = ["mp4", "mov"].first(where: { FileManager.default.fileExists(atPath: self.directory.appendingPathComponent(item.id.uuidString + "." + $0).path) }) {
                            // Recover a crash between the final atomic move and
                            // the manifest write, retaining the user's bytes.
                            let completed = self.directory.appendingPathComponent(item.id.uuidString + "." + ext)
                            let pending = self.directory.appendingPathComponent(item.id.uuidString + ".pending." + ext)
                            do {
                                try FileManager.default.moveItem(at: completed, to: pending)
                                self.validateFile(pending, id: item.id, expectedBytes: item.expectedBytes, ext: ext)
                            } catch { self.fail(item.id, message: error.localizedDescription) }
                        } else {
                            self.releaseSpace(item.id)
                            self.items[index].status = .failed
                            self.items[index].errorMessage = "Der Download wurde unterbrochen. Du kannst ihn erneut starten."
                        }
                    }
                }
                for task in tasks where !self.items.contains(where: { $0.id.uuidString == task.taskDescription && $0.isActive }) { task.cancel() }
                _ = self.persist()
            }
        }
    }

    private func reserveSpace(id: UUID, required: Int64) throws {
        reservationLock.lock()
        defer { reservationLock.unlock() }
        let values = try directory.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        let others = spaceReservations.filter { $0.key != id }.values.reduce(0, +)
        if let available = values.volumeAvailableCapacityForImportantUsage, available < required + others + DownloadSourcePolicy.spaceReserve {
            throw DownloadSourceError.insufficientSpace
        }
        spaceReservations[id] = required
    }
    private func releaseSpace(_ id: UUID) {
        reservationLock.lock()
        spaceReservations.removeValue(forKey: id)
        reservationLock.unlock()
    }

    @discardableResult
    private func persist() -> Bool {
        guard libraryAvailable else { return false }
        do {
            try JSONEncoder().encode(items).write(to: manifest, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            libraryError = nil
            return true
        }
        catch { libraryError = "Die Offlinebibliothek konnte nicht gespeichert werden: \(error.localizedDescription)"; return false }
    }
    private func update(_ id: UUID, _ block: (inout OfflineDownload) -> Void) {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        block(&items[index])
    }
    private func fail(_ id: UUID, message: String) {
        guard let item = items.first(where: { $0.id == id }), item.isActive else { return }
        releaseSpace(id)
        progressTimes.removeValue(forKey: id)
        update(id) { $0.status = .failed; $0.errorMessage = message; $0.fileName = nil }
        _ = persist()
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
                    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard let id = downloadTask.taskDescription.flatMap(UUID.init(uuidString:)),
              let item = items.first(where: { $0.id == id }), item.status == .downloading else { downloadTask.cancel(); return }
        let expected = max(item.expectedBytes, max(0, totalBytesExpectedToWrite))
        do {
            guard totalBytesWritten <= DownloadSourcePolicy.maximumBytes, expected <= DownloadSourcePolicy.maximumBytes else { throw DownloadSourceError.tooLarge }
            let now = ProcessInfo.processInfo.systemUptime
            guard now - (progressTimes[id] ?? 0) >= 0.25 else { return }
            progressTimes[id] = now
            try reserveSpace(id: id, required: max(0, expected - totalBytesWritten))
            update(id) { $0.receivedBytes = totalBytesWritten; $0.expectedBytes = expected }
        } catch { fail(id, message: error.localizedDescription); downloadTask.cancel() }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let id = downloadTask.taskDescription.flatMap(UUID.init(uuidString:)),
              let item = items.first(where: { $0.id == id }), item.status == .downloading else { return }
        var pending = directory.appendingPathComponent(id.uuidString + ".pending.mp4")
        do {
            guard let response = downloadTask.response as? HTTPURLResponse else { throw DownloadSourceError.invalidFile }
            guard response.statusCode == 200 else { throw response.statusCode == 206 ? DownloadSourceError.partialResponse : DownloadSourceError.network(response.statusCode) }
            guard response.value(forHTTPHeaderField: "Content-Range") == nil else { throw DownloadSourceError.partialResponse }
            guard let finalURL = response.url, var source = item.source else { throw DownloadSourceError.invalidFile }
            source.url = finalURL
            // A signed URL may expire after its bytes have fully arrived. That
            // does not invalidate a completed, subsequently verified file.
            try DownloadSourcePolicy.validate(source, checkExpiry: false)
            let mime = response.mimeType?.lowercased() ?? ""
            guard ["video/mp4", "video/x-m4v", "video/quicktime", "application/octet-stream"].contains(mime) else { throw DownloadSourceError.invalidFile }
            let ext = mime == "video/quicktime" ? "mov" : "mp4"
            pending = directory.appendingPathComponent(id.uuidString + ".pending." + ext)
            try FileManager.default.moveItem(at: location, to: pending)
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: pending.path)
            update(id) { $0.status = .validating }
            _ = persist()
            validateFile(pending, id: id, expectedBytes: max(item.expectedBytes, max(0, response.expectedContentLength)), ext: ext)
        } catch { try? FileManager.default.removeItem(at: pending); fail(id, message: error.localizedDescription) }
    }

    private func validateFile(_ pending: URL, id: UUID, expectedBytes: Int64, ext: String = "mp4") {
        // The pending file now occupies real filesystem capacity.
        releaseSpace(id)
        guard let item = items.first(where: { $0.id == id }), item.isActive else {
            try? FileManager.default.removeItem(at: pending); validationFinished(id); return
        }
        validations.insert(id)
        update(id) { $0.status = .validating }
        Task { @MainActor [weak self] in
            guard let self else { return }
            defer { self.validationFinished(id) }
            do {
                let bytes = try await OfflineAssetValidator.validate(pending, expectedBytes: expectedBytes, expectedDuration: item.source?.expectedDuration)
                guard self.items.contains(where: { $0.id == id && $0.isActive }) else { try? FileManager.default.removeItem(at: pending); return }
                let fileName = id.uuidString + "." + ext
                let destination = self.directory.appendingPathComponent(fileName)
                try FileManager.default.moveItem(at: pending, to: destination)
                update(id) { $0.status = .ready; $0.fileName = fileName; $0.receivedBytes = bytes; $0.expectedBytes = bytes; $0.errorMessage = nil; $0.source = nil }
                // Once ready, the signed network source is unnecessary. Local
                // playback and storage survive URL expiry and app relaunch.
                _ = persist()
            } catch {
                try? FileManager.default.removeItem(at: pending)
                fail(id, message: error.localizedDescription)
            }
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error, let id = task.taskDescription.flatMap(UUID.init(uuidString:)) else { return }
        let nsError = error as NSError
        fail(id, message: nsError.code == NSURLErrorCancelled ? "Der Download wurde abgebrochen." : "Der Download wurde unterbrochen: \(error.localizedDescription)")
    }

    func acceptBackgroundEvents(identifier: String, completion: @escaping () -> Void) {
        guard identifier == Self.sessionIdentifier else { completion(); return }
        // Session recreation can deliver the finish event before SwiftUI's
        // app delegate hands over its completion. Keep that unconsumed event;
        // finishBackgroundIfReady clears it only after the handover completes.
        backgroundCompletion = completion
        _ = session
        finishBackgroundIfReady()
    }
    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        eventsFinished = true
        finishBackgroundIfReady()
    }
    private func validationFinished(_ id: UUID) {
        validations.remove(id)
        progressTimes.removeValue(forKey: id)
        finishBackgroundIfReady()
    }
    private func finishBackgroundIfReady() {
        guard eventsFinished, validations.isEmpty, let completion = backgroundCompletion else { return }
        eventsFinished = false; backgroundCompletion = nil
        DispatchQueue.main.async(execute: completion)
    }
}

/// Register with @UIApplicationDelegateAdaptor in LangformApp. Force quitting
/// cancels system downloads; ordinary background/suspension keeps them alive.
final class LangformDownloadAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String,
                     completionHandler: @escaping () -> Void) {
        DownloadStore.shared.acceptBackgroundEvents(identifier: identifier, completion: completionHandler)
    }
}
