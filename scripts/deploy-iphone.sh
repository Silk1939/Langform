#!/bin/bash
set -euo pipefail

LANGFORM_LAUNCH=true
LANGFORM_CHECK_ONLY=false
LANGFORM_BUILD_ONLY=false
for LANGFORM_ARG in "$@"; do
  case "$LANGFORM_ARG" in
    --no-launch) LANGFORM_LAUNCH=false ;;
    --check-signing) LANGFORM_CHECK_ONLY=true ;;
    --build-only) LANGFORM_BUILD_ONLY=true ;;
    *) echo 'Verwendung: deploy-iphone.sh [--no-launch] [--check-signing | --build-only]' >&2; exit 2 ;;
  esac
done

# Only Tan's device. Never select an arbitrary connected iPhone or simulator.
LANGFORM_DEVICE='00008160-001234D11440000A'
LANGFORM_TEAM='RFN59MUTQ3'
LANGFORM_BUNDLE='de.ipekkaya.langform'
# Deliberately pinned: never select a replacement certificate automatically.
LANGFORM_IDENTITY='E94E8C9CC2FF184832B68E4C02A332867D66F560'
LANGFORM_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Keep signed bundles out of the iCloud-synced Desktop. Finder metadata there
# can make codesign reject an otherwise valid app.
LANGFORM_BUILD="$HOME/Library/Developer/Xcode/DerivedData/Langform-device"
LANGFORM_PROFILE_ARGS=()
if [[ -n "${LANGFORM_SIGNING_PROFILES_DIRECTORY:-}" ]]; then
  LANGFORM_PROFILE_ARGS=(--profiles-directory "$LANGFORM_SIGNING_PROFILES_DIRECTORY")
fi
LANGFORM_DESTINATION="platform=iOS,id=$LANGFORM_DEVICE"
if [[ "$LANGFORM_BUILD_ONLY" == true ]]; then
  LANGFORM_DESTINATION='generic/platform=iOS'
fi

# Check local signing material before invoking Xcode or contacting the device.
# This helper only reads the keychain and locally installed profiles.
LANGFORM_PROFILE="$(python3 "$LANGFORM_ROOT/scripts/check-iphone-signing.py" \
  --identity "$LANGFORM_IDENTITY" --team "$LANGFORM_TEAM" \
  --bundle "$LANGFORM_BUNDLE" --device "$LANGFORM_DEVICE" \
  --project "$LANGFORM_ROOT/ios/Langform/Langform.xcodeproj/project.pbxproj" \
  ${LANGFORM_PROFILE_ARGS[@]+"${LANGFORM_PROFILE_ARGS[@]}"})"
if [[ "$LANGFORM_CHECK_ONLY" == true ]]; then
  exit 0
fi

xcodebuild -checkFirstLaunchStatus
if [[ "$LANGFORM_BUILD_ONLY" == false ]] && ! xcrun devicectl device info details --device "$LANGFORM_DEVICE" --timeout 15; then
  echo 'SrTan ist nicht erreichbar. Bitte per Kabel verbinden, entsperren und diesem Mac vertrauen.' >&2
  exit 1
fi

xcodebuild \
  -project "$LANGFORM_ROOT/ios/Langform/Langform.xcodeproj" \
  -scheme Langform \
  -configuration Release \
  -destination "$LANGFORM_DESTINATION" \
  -derivedDataPath "$LANGFORM_BUILD" \
  DEVELOPMENT_TEAM="$LANGFORM_TEAM" CODE_SIGN_STYLE=Manual \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build

# A Personal Team profile is Xcode-managed and cannot be used by Xcode's manual
# signing mode. Build without signing, then embed/sign with the already checked
# local profile and identity. Xcode never gets provisioning authority.
python3 "$LANGFORM_ROOT/scripts/check-iphone-signing.py" \
  --identity "$LANGFORM_IDENTITY" --team "$LANGFORM_TEAM" \
  --bundle "$LANGFORM_BUNDLE" --device "$LANGFORM_DEVICE" \
  --project "$LANGFORM_ROOT/ios/Langform/Langform.xcodeproj/project.pbxproj" \
  --profile "$LANGFORM_PROFILE" \
  --sign-app "$LANGFORM_BUILD/Build/Products/Release-iphoneos/Langform.app" \
  ${LANGFORM_PROFILE_ARGS[@]+"${LANGFORM_PROFILE_ARGS[@]}"}

if [[ "$LANGFORM_BUILD_ONLY" == true ]]; then
  exit 0
fi

xcrun devicectl device install app \
  --device "$LANGFORM_DEVICE" \
  "$LANGFORM_BUILD/Build/Products/Release-iphoneos/Langform.app"

if [[ "$LANGFORM_LAUNCH" == true ]]; then
  xcrun devicectl device process launch \
    --device "$LANGFORM_DEVICE" --timeout 15 --terminate-existing "$LANGFORM_BUNDLE"
fi
