import Foundation
import AVFoundation
import CoreMediaIO

setbuf(stdout, nil)
let arguments = CommandLine.arguments
guard arguments.count == 4, let seconds = Double(arguments[3]), seconds.isFinite, (1...180).contains(seconds) else {
    print("Usage: record-screen SCREEN_SOURCE_UID /absolute/output.mov SECONDS(1...180)"); exit(2)
}
let sourceID = arguments[1]
let destination = URL(fileURLWithPath: arguments[2])
let stopURL = URL(fileURLWithPath: destination.path + ".stop")
let session = AVCaptureSession()
let output = AVCaptureMovieFileOutput()
var stopped = false
var segment = 0
func recordNext() {
    guard !stopped else { return }
    segment += 1
    let file = destination.deletingPathExtension().path + "-part" + String(segment) + ".mov"
    guard !FileManager.default.fileExists(atPath: file) else { print("OUTPUT_EXISTS", file); exit(2) }
    output.startRecording(to: URL(fileURLWithPath:file), recordingDelegate:delegate)
}
final class RecordingDelegate: NSObject, AVCaptureFileOutputRecordingDelegate {
    func fileOutput(_ output: AVCaptureFileOutput, didStartRecordingTo fileURL: URL, from connections: [AVCaptureConnection]) {
        print("RECORDING_STARTED", ISO8601DateFormatter().string(from: Date()), fileURL.path)
    }
    func fileOutput(_ output: AVCaptureFileOutput, didFinishRecordingTo fileURL: URL, from connections: [AVCaptureConnection], error: Error?) {
        if let error { print("RECORDING_ERROR", error) }
        print("RECORDING_FINISHED", fileURL.path)
        if !stopped {
            DispatchQueue.main.asyncAfter(deadline:.now()+0.15) { recordNext() }
        } else {
            session.stopRunning()
            exit(error == nil || (error as NSError?)?.userInfo[AVErrorRecordingSuccessfullyFinishedKey] as? Bool == true ? 0 : 1)
        }
    }
}
let delegate = RecordingDelegate()
var address = CMIOObjectPropertyAddress(mSelector: CMIOObjectPropertySelector(kCMIOHardwarePropertyAllowScreenCaptureDevices), mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal), mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
var enabled: UInt32 = 1
let result = CMIOObjectSetPropertyData(CMIOObjectID(kCMIOObjectSystemObject), &address, 0, nil, UInt32(MemoryLayout<UInt32>.size), &enabled)
guard result == 0 else { print("DEVICE_OPT_IN_FAILED", result); exit(2) }
RunLoop.current.run(until: Date().addingTimeInterval(2))
guard let device = AVCaptureDevice.devices().first(where: { $0.uniqueID == sourceID && $0.localizedName == "SrTan" && $0.hasMediaType(.muxed) }) else { print("SRTAN_SCREEN_SOURCE_UNAVAILABLE"); exit(2) }
print("SOURCE",device.localizedName, "muxed screen")
do {
    let input = try AVCaptureDeviceInput(device: device)
    session.beginConfiguration()
    if session.canSetSessionPreset(.high) { session.sessionPreset = .high }
    guard session.canAddInput(input) else { print("CANNOT_ADD_SCREEN_INPUT"); exit(2) }
    session.addInput(input)
    guard session.canAddOutput(output) else { print("CANNOT_ADD_MOVIE_OUTPUT"); exit(2) }
    session.addOutput(output)
    for connection in output.connections where connection.inputPorts.contains(where: { $0.mediaType == .audio }) { connection.isEnabled = false }
    session.commitConfiguration()
    session.startRunning()
    recordNext()
} catch { print("CAPTURE_SETUP_FAILED",error); exit(2) }
Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { _ in
    if !stopped && FileManager.default.fileExists(atPath: stopURL.path) {
        stopped = true
        output.stopRecording()
    }
}
Timer.scheduledTimer(withTimeInterval: max(15, seconds + 12), repeats: false) { _ in
    print("CAPTURE_DEADLINE")
    stopped = true
    if output.isRecording { output.stopRecording() } else { session.stopRunning(); exit(3) }
}
// A disconnected source may never deliver the completion callback.
Timer.scheduledTimer(withTimeInterval: max(20, seconds + 20), repeats: false) { _ in
    print("CAPTURE_FINALIZATION_DEADLINE"); exit(3)
}
RunLoop.main.run()
