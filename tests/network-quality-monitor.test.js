const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("Netzwerkhinweise bleiben unbekannt bis zum ersten Pfad, deduplizieren und enden mit der Stage", {
  skip: process.platform !== "darwin",
  timeout: 70000,
}, function (t) {
  const compiler = spawnSync("/usr/bin/xcrun", ["--find", "swift"], { encoding: "utf8" });
  if (compiler.status !== 0) return t.skip("Der Netzwerk-Test benötigt die Swift-Toolchain.");
  const source = fs.readFileSync(path.join(__dirname, "../ios/Langform/Langform/NetworkQualityMonitor.swift"), "utf8");
  // Exercise the shipping monitor/lifecycle with controlled paths. This neither
  // alters the host's network nor performs a bandwidth probe.
  const fake = `
import Foundation
enum NWInterface { enum InterfaceType { case wifi, cellular, wiredEthernet, other } }
struct NWPath {
    enum Status { case satisfied, unsatisfied, requiresConnection }
    let status: Status
    let isExpensive: Bool
    let isConstrained: Bool
    let interface: NWInterface.InterfaceType
    func usesInterfaceType(_ type: NWInterface.InterfaceType) -> Bool { type == interface }
}
final class NWPathMonitor {
    static var instances: [NWPathMonitor] = []
    var pathUpdateHandler: ((NWPath) -> Void)?
    var starts = 0
    var cancelled = false
    init() { Self.instances.append(self) }
    func start(queue: DispatchQueue) { starts += 1 }
    func cancel() { cancelled = true }
}
func expect(_ condition: Bool, _ message: String) {
    if !condition { print("FAILED: " + message); exit(1) }
}
`;
  const exercise = `
let monitor = NetworkQualityMonitor()
var reports: [NetworkQualityMonitor.Policy] = []
monitor.onChange = { reports.append($0) }
monitor.start()
expect(monitor.policy == nil && reports.isEmpty, "no synthetic offline report before initial path")
monitor.start()
expect(NWPathMonitor.instances.count == 1 && NWPathMonitor.instances[0].starts == 1, "start is idempotent")
let first = NWPathMonitor.instances[0]
let wifi = NWPath(status: .satisfied, isExpensive: false, isConstrained: false, interface: .wifi)
first.pathUpdateHandler?(wifi)
first.pathUpdateHandler?(wifi)
expect(reports.count == 1, "unchanged path does not trigger JavaScript IPC")
expect(reports.last?.online == true && reports.last?.interface == "wifi", "confirmed WiFi reported")
let costlyWifi = NWPath(status: .satisfied, isExpensive: true, isConstrained: true, interface: .wifi)
first.pathUpdateHandler?(costlyWifi)
expect(reports.last?.expensive == true && reports.last?.constrained == true && reports.last?.interface == "wifi",
       "WiFi does not override low-data/cost flags")
first.pathUpdateHandler?(NWPath(status: .satisfied, isExpensive: false, isConstrained: false, interface: .cellular))
expect(reports.last?.interface == "cellular" && reports.last?.expensive == false, "interface is distinct from cost or measured speed")
first.pathUpdateHandler?(NWPath(status: .satisfied, isExpensive: false, isConstrained: false, interface: .wiredEthernet))
expect(reports.last?.interface == "wired", "wired interface mapped")
first.pathUpdateHandler?(NWPath(status: .requiresConnection, isExpensive: false, isConstrained: false, interface: .other))
expect(reports.last?.online == false && reports.last?.interface == "other", "unavailable path is not online")
let payload = try JSONSerialization.jsonObject(with: Data(monitor.policy!.json!.utf8)) as! [String: Any]
expect(Set(payload.keys) == Set(["online", "expensive", "constrained", "interface"]), "protocol contains hints only, no invented speed or quality")

let delayed = first.pathUpdateHandler
let count = reports.count
monitor.stop()
expect(first.cancelled && first.pathUpdateHandler == nil && monitor.policy == nil, "stop releases observations and snapshot")
delayed?(wifi)
expect(reports.count == count, "queued old callback cannot outlive stage")
monitor.onChange = { reports.append($0) }
monitor.start()
let second = NWPathMonitor.instances[1]
delayed?(wifi)
expect(monitor.policy == nil, "old monitor cannot overwrite a restarted monitor")
second.pathUpdateHandler?(wifi)
expect(reports.count == count + 1 && monitor.policy?.online == true, "new monitor publishes independently")
monitor.stop()
print("NETWORK_POLICY_OK")
`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "langform-network-test-"));
  try {
    const script = path.join(directory, "NetworkPolicy.swift");
    fs.writeFileSync(script, fake + source.replace(/^import Network\s*$/m, "") + exercise);
    const result = spawnSync(compiler.stdout.trim(), [script], { encoding: "utf8", timeout: 60000 });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /NETWORK_POLICY_OK/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
