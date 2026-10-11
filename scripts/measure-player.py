#!/usr/bin/env python3
"""Opt-in native action paths on SrTan, never physical-touch or FPS evidence.

Keeps existing account/cache data. Copies only the app's diagnostic trace.
Install the intended signed build first; this script does not build or install.
"""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile
import time
from diagnostics.trace import read_trace_rows

DEVICE = "00008160-001234D11440000A"
BUNDLE = "de.ipekkaya.langform"
INTERACTION_STEPS = ("minimizePlaying", "pauseMini", "expandPaused", "minimizePaused",
                     "resumeMini", "expandPlaying", "close", "verifyBlank")


def probe_outcome(entries, plan, fixture_count, fullscreen_cycles=None):
    """Completion markers cannot turn a failed or incomplete probe into success."""
    events = [entry.get("event", "") for entry in entries]
    terminal_failures = [event for event in events if event in (
        "video-probe-timeout", "video-probe-cancelled", "player-probe-cancelled",
        "fullscreen-probe-cancelled", "fullscreen-probe-timeout") or
        event.startswith("player-probe-timeout-")]
    failures = ["Terminal probe failure: " + event for event in dict.fromkeys(terminal_failures)]
    missing_steps = []
    if plan == "interaction":
        missing_steps = [step for step in INTERACTION_STEPS
                         if "player-probe-confirmed-" + step not in events]
        if "player-probe-completed" not in events:
            failures.append("Interaction probe did not complete")
        if missing_steps:
            failures.append("Missing confirmed interaction steps: " + ", ".join(missing_steps))
    else:
        if "video-probe-finished" not in events:
            failures.append("Video load probe did not finish")
        missing_requests = [number for number in range(1, fixture_count + 1)
                            if not any(entry.get("scope") == "video-load" and
                                       entry.get("request") == number and
                                       entry.get("event") == "video-playing-report" for entry in entries)]
        if missing_requests:
            failures.append("Missing playing reports for video requests: " +
                            ", ".join(str(number) for number in missing_requests))
    fullscreen_completed = "fullscreen-probe-finished" in events
    if fullscreen_cycles is not None:
        if not fullscreen_completed:
            failures.append("Requested fullscreen probe did not finish")
        opened, inline = events.count("fullscreen-probe-opened"), events.count("fullscreen-probe-inline")
        if opened != fullscreen_cycles or inline != fullscreen_cycles:
            failures.append(f"Requested {fullscreen_cycles} fullscreen cycles; observed {opened} opened and {inline} inline")
            fullscreen_completed = False
    return {"probeSucceeded": not failures, "probeFailureReasons": failures,
            "terminalFailureEvents": list(dict.fromkeys(terminal_failures)),
            "missingInteractionSteps": missing_steps,
            "diagnosticFullscreenProbeCompleted": fullscreen_completed}


def command(args):
    return subprocess.run(["xcrun", "devicectl", *args], check=True,
                          capture_output=True, text=True, timeout=20)


def copy_current_trace(trace, pid):
    """A failed/incomplete device transfer never overwrites the last valid copy."""
    with tempfile.NamedTemporaryFile(prefix=trace.name + ".", suffix=".copy",
                                     dir=trace.parent, delete=False) as temporary:
        candidate = Path(temporary.name)
    try:
        command(["device", "copy", "from", "--device", DEVICE,
                 "--domain-type", "appDataContainer", "--domain-identifier", BUNDLE,
                 "--source", "Library/Caches/langform-startup.jsonl",
                 "--destination", str(candidate), "--timeout", "15", "--quiet"])
        rows = read_trace_rows(candidate)
        if not rows or rows[0].get("processID") != pid:
            return None
        candidate.replace(trace)
        return rows
    finally:
        candidate.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--label", required=True)
    parser.add_argument("--plan", choices=["load", "interaction"], default="load")
    parser.add_argument("--spa", action="store_true")
    parser.add_argument("--full-load", action="store_true", help="Compare without the reusable player router")
    parser.add_argument("--explicit-play", action="store_true", help="One opt-in native Start per diagnostic request; never autoplay evidence")
    parser.add_argument("--player-trace", action="store_true", help="Include bounded diagnostic media/control events")
    parser.add_argument("--initial-delay", type=float, default=2, help="2–15 s of idle time before the first request")
    parser.add_argument("--interaction-delay", type=float, default=0, help="0–20 s diagnostic-only wait for profiler attachment")
    parser.add_argument("--step-delay", type=float, default=0, help="0–3 s between confirmed interaction steps for screen inspection")
    parser.add_argument("--fullscreen-probe", action="store_true", help="Opt-in production fullscreen entry/exit before diagnostic Close")
    parser.add_argument("--fullscreen-cycles", type=int, help="1–6 actual fullscreen cycles; requires fullscreen-probe (default: 1)")
    parser.add_argument("--fullscreen-hold", type=float, help="0.2–3 s after each committed fullscreen/inline pose; requires fullscreen-probe (default: 3)")
    parser.add_argument("--output", type=Path, default=Path("docs/qa/player"))
    args = parser.parse_args()
    if not 0 <= args.step_delay <= 3 or (args.step_delay and args.plan != "interaction"):
        parser.error("step-delay must be 0–3 seconds and requires the interaction plan")
    if args.fullscreen_probe and args.plan != "interaction":
        parser.error("fullscreen-probe requires the interaction plan")
    if args.fullscreen_cycles is not None and (not args.fullscreen_probe or not 1 <= args.fullscreen_cycles <= 6):
        parser.error("fullscreen-cycles must be 1–6 and requires fullscreen-probe")
    if args.fullscreen_hold is not None and (not args.fullscreen_probe or not .2 <= args.fullscreen_hold <= 3):
        parser.error("fullscreen-hold must be 0.2–3 seconds and requires fullscreen-probe")
    fullscreen_cycles = args.fullscreen_cycles if args.fullscreen_cycles is not None else 1
    fullscreen_hold_ms = round((args.fullscreen_hold if args.fullscreen_hold is not None else 3) * 1000)
    fullscreen_budget = min(60, 4 + fullscreen_cycles * (4 + 2 * fullscreen_hold_ms / 1000)) if args.fullscreen_probe else 0
    if not args.label or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789-" for c in args.label):
        parser.error("label must use lowercase letters, numbers and hyphens")
    args.output.mkdir(parents=True, exist_ok=True)
    trace = args.output / (args.label + ".jsonl")
    launch_path = Path("/tmp") / ("langform-" + args.label + "-launch.json")
    fixtures = ["aqz-KE-bpKQ"] if args.plan == "interaction" else ["M7lc1UVf-VE", "aqz-KE-bpKQ"]
    environment = {"LANGFORM_DIAGNOSTICS": "1", "LANGFORM_VIDEO_PROBE": json.dumps(fixtures)}
    if args.explicit_play:
        environment["LANGFORM_VIDEO_PROBE_PLAY"] = "1"
    if args.player_trace:
        environment["LANGFORM_PLAYER_TRACE"] = "1"
    if not 2 <= args.initial_delay <= 15 or (args.spa and args.full_load):
        parser.error("initial-delay must be 2–15; choose at most one routing override")
    environment["LANGFORM_VIDEO_PROBE_INITIAL_DELAY"] = str(args.initial_delay)
    if args.plan == "interaction":
        environment["LANGFORM_PLAYER_PROBE"] = "1"
        if not 0 <= args.interaction_delay <= 20:
            parser.error("interaction-delay must be between 0 and 20 seconds")
        environment["LANGFORM_PLAYER_PROBE_DELAY"] = str(args.interaction_delay)
        environment["LANGFORM_PLAYER_PROBE_STEP_DELAY"] = str(args.step_delay)
        if args.fullscreen_probe:
            environment["LANGFORM_FULLSCREEN_PROBE"] = "1"
            environment["LANGFORM_FULLSCREEN_PROBE_CYCLES"] = str(fullscreen_cycles)
            environment["LANGFORM_FULLSCREEN_PROBE_HOLD_MS"] = str(fullscreen_hold_ms)
    if args.spa:
        environment["LANGFORM_PLAYER_SPA"] = "1"
    elif args.full_load:
        environment["LANGFORM_PLAYER_SPA"] = "0"
    command(["device", "process", "launch", "--device", DEVICE, "--terminate-existing",
             "--environment-variables", json.dumps(environment),
             "--json-output", str(launch_path), "--timeout", "15", BUNDLE])
    launch = json.loads(launch_path.read_text())
    pid = launch.get("result", {}).get("process", {}).get("processIdentifier")
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
        raise RuntimeError("launch returned no valid PID; refusing unrelated diagnostic data")
    print(json.dumps({"label": args.label, "pid": pid, "plan": args.plan, "spa": args.spa,
                      "explicitNativeStartRequested": args.explicit_play,
                      "playerTraceRequested": args.player_trace}), flush=True)
    deadline = time.monotonic() + (48 + 7 * args.step_delay + fullscreen_budget + (2 if args.fullscreen_probe else 0) if args.plan == "interaction" else 75)
    displayed = 0
    finished = False
    events = []
    entries = []
    copy_failures = 0
    total_copy_failures = 0
    idle_recovery_attempted = False
    capture_error = None
    while time.monotonic() < deadline:
        try:
            copied_entries = copy_current_trace(trace, pid)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError, ValueError) as error:
            copy_failures += 1
            total_copy_failures += 1
            detail = error.stderr.strip() if isinstance(error, subprocess.CalledProcessError) and isinstance(error.stderr, str) else str(error)
            print(json.dumps({"copyFailure": copy_failures, "detail": detail,
                              "preservedCurrentProcessTrace": bool(entries)}), flush=True)
            if copy_failures >= 3:
                if idle_recovery_attempted:
                    capture_error = "Repeated trace-copy failure after the single idle recovery"
                    break
                idle_recovery_attempted = True
                print(json.dumps({"traceCopyIdleRecovery": "one bounded fetch after 2 seconds"}), flush=True)
                time.sleep(2)
                try:
                    copied_entries = copy_current_trace(trace, pid)
                    if copied_entries is None:
                        capture_error = "Idle trace fetch returned no valid current-process records"
                except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError, ValueError) as recovery_error:
                    total_copy_failures += 1
                    capture_error = "Idle trace fetch failed: " + str(recovery_error)
                if capture_error:
                    break
            else:
                time.sleep(.5)
                continue
        if copied_entries is None:
            # launch may return before app-init replaces an older trace.
            time.sleep(.2)
            continue
        copy_failures = 0
        entries = copied_entries
        for entry in entries[displayed:]:
            if entry.get("scope") == "video-load" or "probe" in entry.get("event", ""):
                print(json.dumps(entry, sort_keys=True), flush=True)
        displayed = len(entries)
        events = [entry.get("event", "") for entry in entries]
        if ("video-probe-finished" in events or "player-probe-completed" in events or
                "video-probe-cancelled" in events or "player-probe-cancelled" in events or
                "fullscreen-probe-cancelled" in events or "fullscreen-probe-timeout" in events or
                any(event.startswith("player-probe-timeout-") for event in events) or
                ("video-probe-timeout" in events and args.plan == "interaction") or
                (events.count("video-probe-timeout") >= 2)):
            # Keep the final reveal/close completion in the trace as well.
            if finished:
                break
            finished = True
        time.sleep(2)
    outcome = probe_outcome(entries, args.plan, len(fixtures), fullscreen_cycles if args.fullscreen_probe else None)
    if capture_error:
        outcome["probeSucceeded"] = False
        outcome["probeFailureReasons"].append("Trace capture failed: " + capture_error)
    report = {"label": args.label, "device": "SrTan", "bundle": BUNDLE, "pid": pid,
              "plan": args.plan, "routingOverride": "full-load" if args.full_load else "spa" if args.spa else "app-default",
              "diagnosticInitialDelaySeconds": args.initial_delay,
              "diagnosticInteractionDelaySeconds": args.interaction_delay,
              "diagnosticStepDelaySeconds": args.step_delay,
              "diagnosticFullscreenProbeRequested": args.fullscreen_probe,
              "diagnosticFullscreenCyclesRequested": fullscreen_cycles if args.fullscreen_probe else None,
              "diagnosticFullscreenHoldMilliseconds": fullscreen_hold_ms if args.fullscreen_probe else None,
              "diagnosticFullscreenTimeoutSeconds": fullscreen_budget if args.fullscreen_probe else None,
              **outcome,
              "diagnosticFullscreenOpenedCount": events.count("fullscreen-probe-opened"),
              "diagnosticFullscreenInlineCount": events.count("fullscreen-probe-inline"),
              "explicitNativeStartRequested": args.explicit_play,
              "explicitNativeStartInvocationCount": events.count("video-probe-native-start"),
              "explicitNativeStartEvidence": "native invocation only; confirm actual media playing separately",
              "playbackStartMode": "explicit-native-start" if args.explicit_play else "website-controlled",
              "playerTraceRequested": args.player_trace,
              "playerTraceObserved": bool(entries and entries[0].get("playerTrace") is True),
              "conditions": "Release, process restart, existing persistent WebKit data; native action plan; no physical touch",
              "autoplayEvidence": False,
              "traceCopyFailureCount": total_copy_failures,
              "traceCopyIdleRecoveryAttempted": idle_recovery_attempted,
              "traceCopyError": capture_error,
              "preservedCurrentProcessTrace": bool(entries),
              "terminalEventObserved": finished, "events": events,
              "requests": [[e for e in entries if e.get("scope") == "video-load" and e.get("request") == number]
                           for number in sorted({e["request"] for e in entries if "request" in e})]}
    (args.output / (args.label + "-summary.json")).write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"trace": str(trace), "terminalEventObserved": finished,
                      "probeSucceeded": outcome["probeSucceeded"],
                      "probeFailureReasons": outcome["probeFailureReasons"],
                      "traceCopyError": capture_error,
                      "preservedCurrentProcessTrace": bool(entries)}), flush=True)
    if capture_error:
        raise RuntimeError(capture_error + "; the last valid trace and explicit partial report were preserved")
    if not outcome["probeSucceeded"]:
        raise RuntimeError("; ".join(outcome["probeFailureReasons"]) +
                           "; the available trace and explicit partial report were preserved")


if __name__ == "__main__":
    main()
