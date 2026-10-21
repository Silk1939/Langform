import Foundation
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

/// A CPU engine gets an empty file cache, never a previously packed cache.
/// The owner must destroy the native engine before closing/releasing this lease.
final class GemmaRuntimeCacheLease: @unchecked Sendable {
    let directory: URL

    private static let markerName = ".langform-cache-v1"
    private static let lockName = ".lease.lock"
    private let mutex = NSLock()
    private var rootFD: Int32
    private var directoryFD: Int32
    private var lockFD: Int32
    private let name: String

    private init(directory: URL, name: String, rootFD: Int32, directoryFD: Int32, lockFD: Int32) {
        self.directory = directory
        self.name = name
        self.rootFD = rootFD
        self.directoryFD = directoryFD
        self.lockFD = lockFD
    }

    static func defaultRoot() throws -> URL {
        guard let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else {
            throw CacheError.unsafeDirectory
        }
        return caches.appendingPathComponent("LangformGemmaRuntimeCPU-v1", isDirectory: true)
    }

    static func acquire(root: URL? = nil) throws -> GemmaRuntimeCacheLease {
        let folder = try (root ?? defaultRoot()).standardizedFileURL
        guard folder.isFileURL else { throw CacheError.unsafeDirectory }
        if mkdir(folder.path, 0o700) != 0 && errno != EEXIST { throw systemError() }
        let parent = open(folder.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard parent >= 0 else { throw systemError() }
        var transferred = false
        defer { if !transferred { _ = systemClose(parent) } }
        if root == nil {
            var excluded = folder
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try excluded.setResourceValues(values)
        }
        pruneStale(in: parent)
        let identifier = UUID().uuidString.lowercased()
        let name = "lease-" + identifier
        guard mkdirat(parent, name, 0o700) == 0 else { throw systemError() }
        let child = openat(parent, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard child >= 0 else {
            let failure = systemError()
            _ = unlinkat(parent, name, AT_REMOVEDIR)
            throw failure
        }
        var leaseLock: Int32 = -1
        do {
            leaseLock = openat(child, lockName, O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
            guard leaseLock >= 0 else { throw systemError() }
            guard flock(leaseLock, LOCK_EX | LOCK_NB) == 0 else { throw systemError() }
            // Publish the recognizable marker only after the lock is held.
            // Another process can never mistake an initializing lease for stale.
            let marker = openat(child, markerName, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
            guard marker >= 0 else { throw systemError() }
            do {
                try writeAll(markerData(identifier), to: marker)
                _ = systemClose(marker)
            } catch {
                _ = systemClose(marker)
                throw error
            }
            let lease = GemmaRuntimeCacheLease(directory: folder.appendingPathComponent(name, isDirectory: true),
                name: name, rootFD: parent, directoryFD: child, lockFD: leaseLock)
            transferred = true
            return lease
        } catch {
            removeOwnedDirectory(parent: parent, name: name, child: child)
            if leaseLock >= 0 { _ = systemClose(leaseLock) }
            _ = systemClose(child)
            throw error
        }
    }

    /// Idempotent. Call only after native engine deletion, including failure paths.
    func close() {
        mutex.lock()
        let parent = rootFD, child = directoryFD, held = lockFD
        rootFD = -1
        directoryFD = -1
        lockFD = -1
        mutex.unlock()
        guard parent >= 0 else { return }
        // Keep the lock held through deletion. Work relative to the opened root,
        // and check the directory inode so a replaced path is never removed.
        Self.removeOwnedDirectory(parent: parent, name: name, child: child)
        _ = flock(held, LOCK_UN)
        _ = Self.systemClose(held)
        _ = Self.systemClose(child)
        _ = Self.systemClose(parent)
    }

    deinit { close() }

    private enum CacheError: Error { case unsafeDirectory, io(Int32) }

    private static func systemError() -> CacheError { .io(errno) }

    private static func systemClose(_ fd: Int32) -> Int32 {
        #if canImport(Darwin)
        return Darwin.close(fd)
        #else
        return Glibc.close(fd)
        #endif
    }

    private static func identifier(in name: String) -> String? {
        guard name.hasPrefix("lease-") else { return nil }
        let value = String(name.dropFirst(6))
        guard UUID(uuidString: value)?.uuidString.lowercased() == value else { return nil }
        return value
    }

    private static func markerData(_ identifier: String) -> Data {
        Data("LangformGemmaRuntimeCPU\nschema=1\nlease=\(identifier)\n".utf8)
    }

    private static func regularSingleLink(_ fd: Int32) -> Bool {
        var value = stat()
        return fstat(fd, &value) == 0 && (value.st_mode & S_IFMT) == S_IFREG
            && value.st_nlink == 1 && value.st_uid == geteuid()
    }

    private static func markerMatches(in child: Int32, identifier: String) -> Bool {
        let fd = openat(child, markerName, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
        guard fd >= 0 else { return false }
        defer { _ = systemClose(fd) }
        let expected = markerData(identifier)
        var info = stat()
        guard regularSingleLink(fd), fstat(fd, &info) == 0, info.st_size == expected.count else { return false }
        var bytes = [UInt8](repeating: 0, count: expected.count)
        var offset = 0
        while offset < bytes.count {
            let count = bytes.withUnsafeMutableBytes { buffer in
                read(fd, buffer.baseAddress!.advanced(by: offset), buffer.count - offset)
            }
            if count < 0 && errno == EINTR { continue }
            guard count > 0 else { return false }
            offset += count
        }
        return Data(bytes) == expected
    }

    private static func writeAll(_ data: Data, to fd: Int32) throws {
        var offset = 0
        while offset < data.count {
            let count = data.withUnsafeBytes { buffer in
                write(fd, buffer.baseAddress!.advanced(by: offset), buffer.count - offset)
            }
            if count < 0 && errno == EINTR { continue }
            guard count > 0 else { throw systemError() }
            offset += count
        }
    }

    private static func entries(in fd: Int32) -> [String] {
        let copy = dup(fd)
        guard copy >= 0 else { return [] }
        guard let stream = fdopendir(copy) else { _ = systemClose(copy); return [] }
        defer { closedir(stream) }
        var names: [String] = []
        while let entry = readdir(stream) {
            let capacity = MemoryLayout.size(ofValue: entry.pointee.d_name)
            let name = withUnsafePointer(to: &entry.pointee.d_name) {
                $0.withMemoryRebound(to: CChar.self, capacity: capacity) { String(cString: $0) }
            }
            if name != "." && name != ".." { names.append(name) }
        }
        return names
    }

    private static func sameEntry(parent: Int32, name: String, child: Int32) -> Bool {
        var actual = stat(), opened = stat()
        return fstatat(parent, name, &actual, AT_SYMLINK_NOFOLLOW) == 0
            && fstat(child, &opened) == 0 && (actual.st_mode & S_IFMT) == S_IFDIR
            && actual.st_dev == opened.st_dev && actual.st_ino == opened.st_ino
    }

    private static func pruneStale(in parent: Int32) {
        for name in entries(in: parent) {
            guard let id = identifier(in: name) else { continue }
            let child = openat(parent, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
            guard child >= 0 else { continue }
            defer { _ = systemClose(child) }
            guard markerMatches(in: child, identifier: id) else { continue }
            let held = openat(child, lockName, O_RDWR | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
            guard held >= 0 else { continue }
            defer { _ = systemClose(held) }
            guard regularSingleLink(held), flock(held, LOCK_EX | LOCK_NB) == 0 else { continue }
            defer { _ = flock(held, LOCK_UN) }
            guard markerMatches(in: child, identifier: id) else { continue }
            removeOwnedDirectory(parent: parent, name: name, child: child)
        }
    }

    private static func removeOwnedDirectory(parent: Int32, name: String, child: Int32) {
        guard sameEntry(parent: parent, name: name, child: child) else { return }
        removeContents(in: child)
        guard sameEntry(parent: parent, name: name, child: child) else { return }
        _ = unlinkat(parent, name, AT_REMOVEDIR)
    }

    private static func removeContents(in fd: Int32) {
        for name in entries(in: fd) {
            var info = stat()
            guard fstatat(fd, name, &info, AT_SYMLINK_NOFOLLOW) == 0 else { continue }
            if (info.st_mode & S_IFMT) == S_IFDIR {
                let child = openat(fd, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                guard child >= 0 else { continue }
                removeOwnedDirectory(parent: fd, name: name, child: child)
                _ = systemClose(child)
            } else {
                // In a proven own cache, unlink a contained symlink itself,
                // never its target. Unknown entries at the root are untouched.
                _ = unlinkat(fd, name, 0)
            }
        }
    }
}
