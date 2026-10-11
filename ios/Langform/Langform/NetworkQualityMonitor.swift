import Foundation
import Network

/// Connection-cost hints only. An interface type is not a bandwidth measurement.
/// All lifecycle calls and path deliveries use the main queue.
final class NetworkQualityMonitor {
    struct Policy: Codable, Equatable {
        let online: Bool
        let expensive: Bool
        let constrained: Bool
        let interface: String

        init(path: NWPath) {
            online = path.status == .satisfied
            expensive = path.isExpensive
            constrained = path.isConstrained
            if path.usesInterfaceType(.wifi) { interface = "wifi" }
            else if path.usesInterfaceType(.cellular) { interface = "cellular" }
            else if path.usesInterfaceType(.wiredEthernet) { interface = "wired" }
            else { interface = "other" }
        }

        var json: String? {
            guard let data = try? JSONEncoder().encode(self) else { return nil }
            return String(data: data, encoding: .utf8)
        }
    }

    private var monitor: NWPathMonitor?
    private(set) var policy: Policy?
    var onChange: ((Policy) -> Void)?

    func start() {
        guard monitor == nil else { return }
        let next = NWPathMonitor()
        monitor = next
        // currentPath is not a confirmed observation before the first callback.
        // Leave policy nil so startup uses Auto rather than inventing an outage.
        next.pathUpdateHandler = { [weak self, weak next] path in
            guard let self, let next, self.monitor === next else { return }
            let policy = Policy(path: path)
            guard self.policy != policy else { return }
            self.policy = policy
            self.onChange?(policy)
        }
        next.start(queue: .main)
    }

    func stop() {
        let old = monitor
        monitor = nil
        old?.pathUpdateHandler = nil
        old?.cancel()
        policy = nil
        onChange = nil
    }

    deinit {
        monitor?.cancel()
    }
}
