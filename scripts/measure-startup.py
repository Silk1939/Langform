#!/usr/bin/env python3
"""Measure an already-installed Langform build on SrTan without clearing data.

App must include StartupDiagnostics. Values begin at Swift app initialization,
not at the shell command or icon touch. Visible feed content is NOT a UI action.
"""
import argparse
import json
from pathlib import Path
import statistics
import subprocess
import time
from diagnostics.trace import read_trace_rows

DEVICE = "00008160-001234D11440000A"
BUNDLE = "de.ipekkaya.langform"


def run(*args):
    subprocess.run(["xcrun", "devicectl", *args], check=True, stdout=subprocess.DEVNULL)


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--label", required=True, help="e.g. improved-release")
parser.add_argument("--runs", type=int, default=3)
parser.add_argument("--settle", type=float, default=7, help="seconds after each launch, max 60")
parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "docs/qa/startup")
args = parser.parse_args()
if not 1 <= args.runs <= 10 or not 1 <= args.settle <= 60:
    parser.error("runs must be 1–10 and settle 1–60 seconds")
if not args.label or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789-_" for c in args.label):
    parser.error("label must contain lowercase letters, digits, - or _")
args.output.mkdir(parents=True, exist_ok=True)
rows = []
for index in range(1, args.runs + 1):
    run("device", "process", "launch", "--device", DEVICE, "--terminate-existing",
        "--environment-variables", json.dumps({"LANGFORM_DIAGNOSTICS": "1"}), BUNDLE)
    time.sleep(args.settle)
    target = args.output / f"{args.label}-{index}.jsonl"
    run("device", "copy", "from", "--device", DEVICE, "--domain-type", "appDataContainer",
        "--domain-identifier", BUNDLE, "--source", "Library/Caches/langform-startup.jsonl",
        "--destination", str(target))
    events = read_trace_rows(target)
    markers = {e["event"]: round(e["milliseconds"], 2) for e in events}
    rows.append(markers)
    print(json.dumps({"run": index, "markers": markers}), flush=True)
for event in ("feed-load-requested", "native-layout", "feed-shell-visible", "feed-content-visible"):
    values = [row[event] for row in rows if event in row]
    print(f"{event}: {len(values)}/{len(rows)} runs, median {statistics.median(values):.2f} ms" if values
          else f"{event}: no measurement")
