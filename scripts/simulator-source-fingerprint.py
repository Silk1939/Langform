#!/usr/bin/env python3
"""Content fingerprint for deciding whether the iOS Simulator needs a new run."""
from pathlib import Path
import hashlib
import json

root = Path(__file__).resolve().parent.parent
folders = [
    "ios/Langform/Langform", "ios/Langform/Langform.xcodeproj",
    "ios/DeviceTests/LangformDeviceTests", "ios/DeviceTests/LangformDeviceTests.xcodeproj",
    "extension/src",
]
suffixes = {".swift", ".js", ".plist", ".pbxproj", ".xcscheme", ".xcassets", ".json"}
files = {
    p for folder in folders for p in (root / folder).rglob("*")
    if p.is_file() and not p.is_symlink() and p.suffix in suffixes
}
files.update(root / p for p in [
    "ios/Langform/Info.plist", "scripts/test-simulator.sh",
    "scripts/simulator-source-fingerprint.py", "AGENTS.md",
])
digest = hashlib.sha256()
for path in sorted(files):
    digest.update(str(path.relative_to(root)).encode())
    digest.update(b"\0")
    digest.update(path.read_bytes())
    digest.update(b"\0")
print(json.dumps({"sha256": digest.hexdigest(), "file_count": len(files)}))
