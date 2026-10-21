#!/bin/bash
# Repeatable iOS UI smoke test. Uses only the Simulator; no provisioning access.
set -euo pipefail

task_root="$(cd "$(dirname "$0")/.." && pwd)"
task_device="${LANGFORM_SIMULATOR_UDID:-}"
task_iterations=1
task_output=""
task_only=""
task_package_args=()
if [[ -n "${LANGFORM_SOURCE_PACKAGES_DIRECTORY:-}" ]]; then
  task_package_args=(-clonedSourcePackagesDirPath "$LANGFORM_SOURCE_PACKAGES_DIRECTORY")
fi
while [[ $# -gt 0 ]]; do
  case "$1" in
    --device) task_device="$2"; shift 2 ;;
    --iterations) task_iterations="$2"; shift 2 ;;
    --output) task_output="$2"; shift 2 ;;
    --only-testing) task_only="$2"; shift 2 ;;
    *) printf 'Usage: %s [--device UDID] [--iterations N] [--output DIRECTORY] [--only-testing TEST_ID]\n' "$0" >&2; exit 2 ;;
  esac
done
[[ "$task_iterations" =~ ^[1-9][0-9]*$ ]] || { printf 'Iterations must be a positive integer.\n' >&2; exit 2; }

if [[ -z "$task_device" ]]; then
  task_device="$(xcrun simctl list devices available -j | /usr/bin/python3 -c '
import json, sys
items = [(runtime, device) for runtime, devices in json.load(sys.stdin)["devices"].items()
         for device in devices if "iPhone" in device.get("deviceTypeIdentifier", "")]
if not items:
    sys.exit("No available iPhone Simulator. Install the iOS runtime in Xcode first.")
def key(item):
    runtime, device = item
    version = tuple(int(p) for p in runtime.rsplit("iOS-", 1)[-1].split("-") if p.isdigit())
    return version, device["name"] == "iPhone 18 Pro", device["name"]
print(max(items, key=key)[1]["udid"])
')"
fi

if [[ -z "$task_output" ]]; then
  task_output="$task_root/docs/qa/simulator-runs/$(date +%Y%m%d-%H%M%S)"
fi
mkdir -p "$task_output"
task_output="$(cd "$task_output" && pwd)"
task_derived="$HOME/Library/Developer/Xcode/DerivedData/Langform-simulator"
task_test_derived="$HOME/Library/Developer/Xcode/DerivedData/Langform-simulator-tests"
task_lock="$HOME/Library/Developer/Xcode/DerivedData/.langform-simulator-test-lock"
mkdir -p "$(dirname "$task_lock")"
mkdir "$task_lock" 2>/dev/null || { printf 'Another Langform Simulator run is active.\n' >&2; exit 2; }
trap 'rmdir "$task_lock"' EXIT

cd "$task_root"
xcrun simctl list runtimes -j > "$task_output/runtimes.json"
xcrun simctl list devices available -j > "$task_output/devices.json"
task_boot_state="$(xcrun simctl list devices available -j | /usr/bin/python3 -c '
import json, sys
udid = sys.argv[1]
for devices in json.load(sys.stdin)["devices"].values():
    for device in devices:
        if device["udid"] == udid:
            print(device["state"])
            sys.exit(0)
sys.exit("Requested Simulator is unavailable.")
' "$task_device")"
if [[ "$task_boot_state" != Booted ]]; then
  xcrun simctl boot "$task_device"
fi
xcrun simctl bootstatus "$task_device" -b > "$task_output/boot.log" 2>&1

printf 'Building Langform for Simulator %s.\n' "$task_device"
xcodebuild build -quiet -project ios/Langform/Langform.xcodeproj -scheme Langform \
  ${task_package_args[@]+"${task_package_args[@]}"} \
  -configuration Debug -sdk iphonesimulator -destination "platform=iOS Simulator,id=$task_device" \
  -derivedDataPath "$task_derived" CODE_SIGNING_ALLOWED=NO \
  > "$task_output/app-build.log" 2>&1
xcrun simctl install "$task_device" "$task_derived/Build/Products/Debug-iphonesimulator/Langform.app"

printf 'Running iOS UI smoke tests (%s iteration(s)).\n' "$task_iterations"
task_test_command=(xcodebuild test -project ios/DeviceTests/LangformDeviceTests.xcodeproj -scheme LangformDeviceTests \
  -configuration Debug -sdk iphonesimulator -destination "platform=iOS Simulator,id=$task_device" \
  -derivedDataPath "$task_test_derived" -resultBundlePath "$task_output/smoke.xcresult" \
  -parallel-testing-enabled NO -maximum-concurrent-test-simulator-destinations 1 \
  -collect-test-diagnostics never \
  -testLanguage de -testRegion DE \
  -skip-testing:LangformDeviceTests/DeviceAccessibilityTests/test03PublicWatchAndReadOnlyCommentsIfIdentifiable \
  CODE_SIGNING_ALLOWED=NO SUPPORTED_PLATFORMS=iphonesimulator)
if [[ "$task_iterations" -gt 1 ]]; then
  task_test_command+=(-test-iterations "$task_iterations" -test-repetition-relaunch-enabled YES)
fi
if [[ -n "$task_only" ]]; then
  task_test_command+=(-only-testing "$task_only")
else
  # Historical failing background A/B controls are explicit comparisons, not
  # ordinary smoke criteria. Keep them available via --only-testing; the normal
  # suite uses the silent source and enabled policy in cases 27-30.
  for task_comparison in \
    test19PlayingWatchContinuesThroughHomeAndReturn \
    test20PausedWatchStaysPausedThroughHomeAndReturn \
    test21PlayingWatchWithBackgroundCategoryProbe \
    test22PausedWatchWithBackgroundCategoryProbe \
    test23SilentAudioTrackWatchHomeBaseline \
    test24PausedSilentAudioTrackWatchHomeBaseline \
    test25SilentAudioTrackWatchWithBackgroundCategoryProbe \
    test26PausedSilentAudioTrackWatchWithBackgroundCategoryProbe; do
    task_test_command+=(-skip-testing "LangformDeviceTests/DeviceAccessibilityTests/$task_comparison")
  done
fi
set +e
"${task_test_command[@]}" > "$task_output/smoke.log" 2>&1
task_exit=$?
set -e
if [[ -d "$task_output/smoke.xcresult" ]]; then
  xcrun xcresulttool get test-results summary --path "$task_output/smoke.xcresult" \
    > "$task_output/summary.json"
  # Xcode can exit successfully for a misspelled -only-testing method while
  # executing zero tests. That is not a completed Simulator verification.
  if [[ "$task_exit" -eq 0 ]] && ! /usr/bin/python3 -c '
import json, sys
summary = json.load(open(sys.argv[1]))
sys.exit(0 if summary.get("totalTestCount", 0) > 0 else 1)
' "$task_output/summary.json"; then
    printf 'Simulator verification executed zero tests. Check --only-testing.\n' >&2
    task_exit=3
  fi
fi
xcrun simctl io "$task_device" screenshot "$task_output/last-screen.png" \
  > "$task_output/screenshot.log" 2>&1 || true
printf 'Results: %s\n' "$task_output"
exit "$task_exit"
