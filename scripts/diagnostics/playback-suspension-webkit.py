#!/usr/bin/env python3
"""Run offline macOS WebKit suspension regression with current app helpers.

Opens a small temporary WKWebView window, plays a silent local WAV, reproduces
the old unbalanced suspension counter, then verifies the actual shipping
suspend/resume helpers across fresh documents. Emits JSONL and closes the
window. This does not claim iPhone or live YouTube interaction coverage.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile


def method(source: str, name: str) -> str:
    marker = f"private func {name}("
    start = source.index(marker)
    opening = source.index("{", start)
    depth, end = 1, opening + 1
    while depth:
        if source[end] == "{":
            depth += 1
        elif source[end] == "}":
            depth -= 1
        end += 1
    return source[start:end].replace("private func", "func", 1)


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--source", type=Path, help="Optional YouTubeWebView.swift containing the app helpers")
parser.add_argument("--output", type=Path, help="Also save the JSONL result here")
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
source_path = args.source or root / "ios/Langform/Langform/YouTubeWebView.swift"
source = source_path.read_text()
helpers = "\n".join(method(source, name) for name in ("suspendPreparedPlayer", "resumePreparedPlayer"))
harness = Path(__file__).with_name("PlaybackSuspensionWebKit.swift").read_text()
with tempfile.TemporaryDirectory(prefix="langform-playback-suspension-") as temporary:
    directory = Path(temporary)
    swift = directory / "main.swift"
    executable = directory / "playback-suspension"
    swift.write_text(harness + "\nextension SuspensionStage {\n" + helpers + "\n}\n")
    subprocess.run(["xcrun", "swiftc", str(swift), "-o", str(executable)], check=True, timeout=60)
    result = subprocess.run([str(executable)], capture_output=True, text=True, timeout=35)
    metadata = json.dumps({"shippingSource": str(source_path),
                           "shippingHelpersSHA256": hashlib.sha256(helpers.encode()).hexdigest()}, sort_keys=True)
    output = metadata + "\n" + result.stdout
    print(output, end="")
    if result.stderr:
        print(result.stderr, end="", file=sys.stderr)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output)
    raise SystemExit(result.returncode)
