import Foundation
import AVFoundation
import CoreMediaIO
var address = CMIOObjectPropertyAddress(mSelector: CMIOObjectPropertySelector(kCMIOHardwarePropertyAllowScreenCaptureDevices), mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal), mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
var enabled: UInt32 = 1
let result = CMIOObjectSetPropertyData(CMIOObjectID(kCMIOObjectSystemObject), &address, 0, nil, UInt32(MemoryLayout<UInt32>.size), &enabled)
print("SCREEN_DEVICE_OPT_IN",result)
RunLoop.current.run(until: Date().addingTimeInterval(2))
for device in AVCaptureDevice.devices() {
 print("DEVICE", device.localizedName, device.uniqueID, device.hasMediaType(.video), device.hasMediaType(.muxed))
}
