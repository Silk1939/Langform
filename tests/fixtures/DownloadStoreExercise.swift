import Foundation
import Combine

// Native boundaries are deterministic; the Store methods, JSON manifest and
// file operations below are the production source, compiled unchanged except
// for its fixture directory and the iOS-only app-delegate wrapper.
protocol URLSessionDownloadDelegate {}
class URLSessionTask {
    var taskDescription: String?
    var response: URLResponse?
    var cancelled = false
    func cancel() { cancelled = true }
}
final class URLSessionDownloadTask: URLSessionTask {
    var resumed = false
    var request: URLRequest?
    func resume() { resumed = true }
}
final class URLSessionConfiguration {
    static func background(withIdentifier: String) -> URLSessionConfiguration { URLSessionConfiguration() }
    var sessionSendsLaunchEvents = false
    var isDiscretionary = false
    var waitsForConnectivity = false
    var timeoutIntervalForResource = 0.0
    var httpMaximumConnectionsPerHost = 0
    var urlCache: URLCache?
    var allowsCellularAccess = true
    var allowsExpensiveNetworkAccess = true
    var allowsConstrainedNetworkAccess = true
}
final class URLSession {
    static var instances: [URLSession] = []
    static var deferReconnect = false
    static var callbacks: [() -> Void] = []
    var tasks: [URLSessionTask] = []
    init(configuration: URLSessionConfiguration, delegate: URLSessionDownloadDelegate, delegateQueue: OperationQueue) { Self.instances.append(self) }
    func downloadTask(with request: URLRequest) -> URLSessionDownloadTask {
        let task = URLSessionDownloadTask(); task.request = request; tasks.append(task); return task
    }
    func getAllTasks(completionHandler: @escaping ([URLSessionTask]) -> Void) {
        let deliver = { completionHandler(self.tasks) }
        if Self.deferReconnect { Self.callbacks.append(deliver) } else { deliver() }
    }
    static func flush() { let queued = callbacks; callbacks.removeAll(); queued.forEach { $0() } }
}
var fixtureDirectory = URL(fileURLWithPath: "/tmp/unset-download-store-fixture")
var fixtureCapacity: Int64 = 1_000_000_000

@main struct StoreTests {
    static func expect(_ condition: Bool, _ message: String) {
        if !condition { print("FAILED: " + message); exit(1) }
    }
    @MainActor static func settle() async {
        for _ in 0..<50 { await Task.yield(); try? await Task.sleep(nanoseconds: 2_000_000) }
    }
    @MainActor static func waitForValidation(_ store: DownloadStore, id: UUID) async {
        let deadline = Date().addingTimeInterval(10)
        while store.items.first(where: { $0.id == id })?.status == .validating && Date() < deadline {
            await Task.yield()
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        if let item = store.items.first(where: { $0.id == id }) {
            let diagnosticError = item.errorMessage ?? "none"
            print("VALIDATION_TERMINAL status=\(item.status.rawValue) error=\(diagnosticError)")
        }
    }
    @MainActor static func main() async throws {
        let root = URL(fileURLWithPath:CommandLine.arguments[1])
        let asset = URL(fileURLWithPath:CommandLine.arguments[2])
        let bytes = Int64(try Data(contentsOf:asset).count)
        func fresh(_ name:String) -> DownloadStore {
            fixtureDirectory = root.appendingPathComponent(name, isDirectory:true)
            return DownloadStore()
        }
        func source(_ id:String, _ size:Int64 = 200_000_000) -> DownloadSource {
            DownloadSource(url:URL(string:"https://r1.googlevideo.com/videoplayback?expire=4000000000")!, title:id, videoID:id,
                pageURL:URL(string:"https://m.youtube.com/watch?v=" + id)!, mimeType:"video/mp4; codecs=\"avc1.42001E, mp4a.40.2\"",expectedBytes:size,origin:.activeWatch)
        }
        URLSession.deferReconnect = true
        fixtureCapacity = 500_000_000
        let store = fresh("starts")
        let a = try store.start(source("aaaaaaaaaaa"))
        do { _ = try store.start(source("aaaaaaaaaaa")); expect(false,"parallel duplicate refused") } catch {}
        do { _ = try store.start(source("bbbbbbbbbbb")); expect(false,"parallel transfers reserve their remaining bytes") } catch DownloadSourceError.insufficientSpace {}
        let taskA = URLSession.instances.last!.tasks.first as! URLSessionDownloadTask
        URLSession.flush(); await settle()
        expect(store.items.first(where:{$0.id == a})?.status == .downloading && !taskA.cancelled,"late reconnect preserves new start")
        let snapshotA = store.items.first(where:{$0.id == a})!
        store.cancel(snapshotA)
        URLSession.flush(); await settle()
        expect(taskA.cancelled && store.items.first(where:{$0.id == a})?.status == .cancelled,"cancel reaches matching native task")
        let b = try store.start(source("bbbbbbbbbbb"))
        expect(store.items.contains(where:{$0.id == b && $0.isActive}),"cancellation releases reservation")
        store.remove(store.items.first(where:{$0.id == b})!)
        URLSession.flush(); await settle()
        expect(!store.items.contains(where:{$0.id == b}),"remove reaches manifest")
        print("PARALLEL_START_RECONNECT_CANCEL_BUDGET_OK")

        fixtureCapacity = 1_000_000_000
        let finishStore = fresh("finish")
        URLSession.flush(); await settle()
        let completedID = try finishStore.start(source("ccccccccccc",bytes))
        let task = URLSession.instances.last!.tasks.first as! URLSessionDownloadTask
        let temp = root.appendingPathComponent("delegate-temp.mp4")
        try FileManager.default.copyItem(at:asset,to:temp)
        task.response = HTTPURLResponse(url:source("ccccccccccc",bytes).url,statusCode:200,httpVersion:"HTTP/1.1",headerFields:["Content-Type":"video/mp4","Content-Length":String(bytes)])
        finishStore.urlSession(URLSession.instances.last!, downloadTask:task,didFinishDownloadingTo:temp)
        let validating = finishStore.items.first(where:{$0.id == completedID})!
        expect(validating.status == .validating && !FileManager.default.fileExists(atPath:temp.path),"delegate durably moves temporary file")
        var backgroundCompleted = false
        finishStore.acceptBackgroundEvents(identifier:DownloadStore.sessionIdentifier) { backgroundCompleted = true }
        finishStore.urlSessionDidFinishEvents(forBackgroundURLSession:URLSession.instances.last!)
        await settle()
        print("VALIDATION_AFTER_OLD_FIXED_WAIT status=\(finishStore.items.first(where:{$0.id == completedID})!.status.rawValue)")
        await waitForValidation(finishStore, id: completedID)
        // Completion is dispatched after validation; wait for that callback,
        // preserving the separate ready-file and background-handover assertions.
        let completionDeadline = Date().addingTimeInterval(2)
        while !backgroundCompleted && Date() < completionDeadline {
            await Task.yield(); try? await Task.sleep(nanoseconds: 10_000_000)
        }
        expect(finishStore.items.first(where:{$0.id == completedID})?.status == .ready,"real combined asset finishes")
        expect(backgroundCompleted,"background completion waits for validator")
        finishStore.cancel(validating)
        let ready = finishStore.items.first(where:{$0.id == completedID})!
        expect(ready.status == .ready && ready.source == nil && finishStore.fileURL(for:ready) != nil,"stale validation cancel cannot discard completed offline asset")
        let restored = DownloadStore()
        URLSession.flush(); await settle()
        let recovered = restored.items.first(where:{$0.id == completedID})!
        expect(recovered.status == .ready && restored.fileURL(for:recovered) != nil && recovered.source == nil,"manifest survives source expiry and relaunch")
        print("REAL_STORE_COMPLETE_RELAUNCH_AND_STALE_CANCEL_OK")
        try FileManager.default.removeItem(at:restored.fileURL(for:recovered)!)
        expect(restored.fileURL(for:recovered) == nil,"missing ready media cannot be played")
        let missingStore = DownloadStore()
        URLSession.flush(); await settle()
        expect(missingStore.items.first?.status == .failed && missingStore.items.first?.fileName == nil,"relaunch marks missing ready media failed")
        restored.remove(recovered)
        expect(restored.items.isEmpty && !FileManager.default.fileExists(atPath:fixtureDirectory.appendingPathComponent(completedID.uuidString + ".mp4").path),"remove deletes owned media and manifest")

        let partialStore = fresh("partial")
        URLSession.flush(); await settle()
        let partialID = try partialStore.start(source("ddddddddddd",bytes))
        let partialTask = URLSession.instances.last!.tasks.first as! URLSessionDownloadTask
        let partialTemp = root.appendingPathComponent("partial-temp.mp4")
        try FileManager.default.copyItem(at:asset,to:partialTemp)
        partialTask.response = HTTPURLResponse(url:source("ddddddddddd",bytes).url,statusCode:206,httpVersion:"HTTP/1.1",headerFields:["Content-Type":"video/mp4"])
        partialStore.urlSession(URLSession.instances.last!,downloadTask:partialTask,didFinishDownloadingTo:partialTemp)
        expect(partialStore.items.first(where:{$0.id == partialID})?.status == .failed,"HTTP206 never becomes ready")
        expect(partialStore.usedBytes == 0,"partial bytes excluded from offline library")
        print("REAL_STORE_PARTIAL_RESPONSE_REJECTED")
        var lateCompletion = false
        partialStore.urlSessionDidFinishEvents(forBackgroundURLSession:URLSession.instances.last!)
        partialStore.acceptBackgroundEvents(identifier:DownloadStore.sessionIdentifier) { lateCompletion = true }
        await settle()
        expect(lateCompletion,"finish event before delegate handover is retained")
        print("FINISH_BEFORE_BACKGROUND_HANDOVER_OK")

        for ext in ["pending.mp4", "mp4"] {
            fixtureDirectory = root.appendingPathComponent("recovery-" + ext, isDirectory:true)
            try FileManager.default.createDirectory(at:fixtureDirectory,withIntermediateDirectories:true)
            let crashID = UUID()
            let interrupted = OfflineDownload(id:crashID,title:"Interrupted validation",source:source("eeeeeeeeeee",bytes),createdAt:Date(),status:.validating,expectedBytes:bytes)
            try JSONEncoder().encode([interrupted]).write(to:fixtureDirectory.appendingPathComponent("library.json"))
            try FileManager.default.copyItem(at:asset,to:fixtureDirectory.appendingPathComponent(crashID.uuidString + "." + ext))
            let recoveredStore = DownloadStore()
            URLSession.flush(); await settle()
            await waitForValidation(recoveredStore, id: crashID)
            expect(recoveredStore.items.first?.status == .ready && recoveredStore.fileURL(for:recoveredStore.items.first!) != nil,"pending/final crash recovery retains complete media: " + ext)
        }
        print("PENDING_AND_FINAL_CRASH_RECOVERY_OK")

        let cancelledStore = fresh("validation-cancel")
        URLSession.flush(); await settle()
        let cancelID = try cancelledStore.start(source("fffffffffff",bytes))
        let cancelTask = URLSession.instances.last!.tasks.first as! URLSessionDownloadTask
        let cancelTemp = root.appendingPathComponent("cancel-temp.mp4")
        try FileManager.default.copyItem(at:asset,to:cancelTemp)
        cancelTask.response = HTTPURLResponse(url:source("fffffffffff",bytes).url,statusCode:200,httpVersion:"HTTP/1.1",headerFields:["Content-Type":"video/mp4","Content-Length":String(bytes)])
        cancelledStore.urlSession(URLSession.instances.last!,downloadTask:cancelTask,didFinishDownloadingTo:cancelTemp)
        cancelledStore.remove(cancelledStore.items.first(where:{$0.id == cancelID})!)
        URLSession.flush(); await settle()
        expect(cancelledStore.items.isEmpty && !FileManager.default.fileExists(atPath:fixtureDirectory.appendingPathComponent(cancelID.uuidString + ".mp4").path),"late validator cannot resurrect removed media")

        fixtureDirectory = root.appendingPathComponent("corrupt-manifest",isDirectory:true)
        try FileManager.default.createDirectory(at:fixtureDirectory,withIntermediateDirectories:true)
        let corruptManifest = fixtureDirectory.appendingPathComponent("library.json")
        let corruptBytes = Data("not-valid-json".utf8)
        try corruptBytes.write(to:corruptManifest)
        let corruptStore = DownloadStore()
        expect(corruptStore.libraryError != nil,"corrupt library is visible")
        do { _ = try corruptStore.start(source("ggggggggggg",bytes)); expect(false,"corrupt library cannot be silently replaced") } catch {}
        expect(try Data(contentsOf:corruptManifest) == corruptBytes,"corrupt manifest bytes preserved")
        let impossible = OfflineDownload(id:UUID(),title:"Invalid counts",source:nil,createdAt:Date(),status:.downloading,receivedBytes:Int64.min,expectedBytes:Int64.max)
        let invalidCounts = try JSONEncoder().encode([impossible])
        try invalidCounts.write(to:corruptManifest)
        let invalidStore = DownloadStore()
        expect(invalidStore.libraryError != nil && invalidStore.items.isEmpty,"invalid counts cannot overflow restored storage budget")
        expect(try Data(contentsOf:corruptManifest) == invalidCounts,"invalid manifest remains untouched")
        print("CANCEL_DURING_VALIDATION_AND_CORRUPT_MANIFEST_OK")
    }
}
