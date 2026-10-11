const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

test("Mess-CLI setzt expliziten Start und Player-Trace getrennt und bezeichnet sie nie als Autoplaybeweis", () => {
  const script = `
import contextlib, importlib.util, io, json, pathlib, sys, tempfile
sys.path.insert(0, str(pathlib.Path("scripts").resolve()))
spec = importlib.util.spec_from_file_location("measure_player", "scripts/measure-player.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
for switches in [[], ["--explicit-play"], ["--player-trace"], ["--explicit-play", "--player-trace"], ["--explicit-play", "--step-delay", "3"], ["--explicit-play", "--fullscreen-probe"], ["--fullscreen-probe", "--fullscreen-cycles", "6", "--fullscreen-hold", ".25"], ["--fullscreen-probe", "--fullscreen-cycles", "6", "--fullscreen-hold", "3"]]:
    with tempfile.TemporaryDirectory(prefix="langform-measure-cli-") as directory:
        calls, environment, launch_paths = [], {}, []
        def command(args):
            calls.append(args)
            if args[:3] == ["device", "process", "launch"]:
                environment.update(json.loads(args[args.index("--environment-variables") + 1]))
                launch = pathlib.Path(args[args.index("--json-output") + 1]); launch_paths.append(launch)
                launch.write_text(json.dumps({"result":{"process":{"processIdentifier":12345}}}))
            elif args[:3] == ["device", "copy", "from"]:
                trace = pathlib.Path(args[args.index("--destination") + 1])
                entries = [{"event":"app-init", "processID":12345, "playerTrace":environment.get("LANGFORM_PLAYER_TRACE")=="1"}]
                if environment.get("LANGFORM_VIDEO_PROBE_PLAY") == "1":
                    entries.append({"event":"video-probe-native-start"})
                    entries.append({"scope":"video-load", "request":1, "event":"video-explicit-play-requested"})
                if environment.get("LANGFORM_FULLSCREEN_PROBE") == "1":
                    for _ in range(int(environment["LANGFORM_FULLSCREEN_PROBE_CYCLES"])):
                        entries.extend([{"event":"fullscreen-probe-opened"}, {"event":"fullscreen-probe-inline"}])
                    entries.append({"event":"fullscreen-probe-finished"})
                entries.extend({"event":"player-probe-confirmed-"+step} for step in m.INTERACTION_STEPS)
                entries.append({"event":"player-probe-completed"})
                trace.write_text("".join(json.dumps(e)+"\\n" for e in entries))
            else:
                raise AssertionError("Unexpected command " + str(args))
        m.command = command
        m.time.sleep = lambda _: None
        sys.argv = ["measure-player", "--label", "cli-test-"+pathlib.Path(directory).name.lower().replace("_","-"), "--plan", "interaction", "--output", directory, *switches]
        try:
            with contextlib.redirect_stdout(io.StringIO()): m.main()
            report = json.loads(next(pathlib.Path(directory).glob("*-summary.json")).read_text())
            explicit = "--explicit-play" in switches
            trace = "--player-trace" in switches
            assert environment.get("LANGFORM_DIAGNOSTICS") == "1"
            assert environment.get("LANGFORM_VIDEO_PROBE_PLAY") == ("1" if explicit else None)
            assert environment.get("LANGFORM_PLAYER_TRACE") == ("1" if trace else None)
            step_delay = 3 if "--step-delay" in switches else 0
            assert float(environment["LANGFORM_PLAYER_PROBE_STEP_DELAY"]) == step_delay
            assert report["diagnosticStepDelaySeconds"] == step_delay
            assert environment.get("LANGFORM_FULLSCREEN_PROBE") == ("1" if "--fullscreen-probe" in switches else None)
            assert report["diagnosticFullscreenProbeRequested"] == ("--fullscreen-probe" in switches)
            fullscreen = "--fullscreen-probe" in switches
            cycles = int(switches[switches.index("--fullscreen-cycles")+1]) if "--fullscreen-cycles" in switches else 1
            hold_ms = round(float(switches[switches.index("--fullscreen-hold")+1])*1000) if "--fullscreen-hold" in switches else 3000
            assert environment.get("LANGFORM_FULLSCREEN_PROBE_CYCLES") == (str(cycles) if fullscreen else None)
            assert environment.get("LANGFORM_FULLSCREEN_PROBE_HOLD_MS") == (str(hold_ms) if fullscreen else None)
            assert report["diagnosticFullscreenCyclesRequested"] == (cycles if fullscreen else None)
            assert report["diagnosticFullscreenHoldMilliseconds"] == (hold_ms if fullscreen else None)
            assert report["diagnosticFullscreenTimeoutSeconds"] == (min(60, 4+cycles*(4+2*hold_ms/1000)) if fullscreen else None)
            assert report["diagnosticFullscreenOpenedCount"] == report["diagnosticFullscreenInlineCount"] == (cycles if fullscreen else 0)
            assert report["diagnosticFullscreenProbeCompleted"] == fullscreen
            assert report["explicitNativeStartRequested"] == explicit
            assert report["explicitNativeStartInvocationCount"] == int(explicit)
            assert report["playbackStartMode"] == ("explicit-native-start" if explicit else "website-controlled")
            assert report["playerTraceRequested"] == trace and report["playerTraceObserved"] == trace
            assert report["autoplayEvidence"] is False
            assert report["terminalEventObserved"] is True
            assert report["probeSucceeded"] is True and report["probeFailureReasons"] == []
            assert len(calls) == 3, "one process launch and two final-trace copies, no retries of Play/build/install"
        finally:
            for launch in launch_paths: launch.unlink(missing_ok=True)
print("MEASURE_PLAYER_CLI_OK")
`;
  const result = spawnSync("python3", ["-c", script], {cwd:path.join(__dirname,".."),encoding:"utf8",timeout:10000});
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.match(result.stdout,/MEASURE_PLAYER_CLI_OK/);
});

test("Screenshot-Abstand ist begrenzt und nur mit der Bedienprobe zulässig", () => {
  for (const args of [
    ["--plan", "interaction", "--step-delay", "-1"],
    ["--plan", "interaction", "--step-delay", "4"],
    ["--plan", "interaction", "--step-delay", "nan"],
    ["--plan", "load", "--step-delay", "1"],
  ]) {
    const result = spawnSync("python3", ["scripts/measure-player.py", "--label", "invalid-delay", ...args], {
      cwd:path.join(__dirname,".."), encoding:"utf8", timeout:3000,
    });
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, /step-delay must be 0–3 seconds and requires the interaction plan/);
    assert.equal(result.stdout, "", "invalid delay must fail before any device command");
  }
});

test("Fullscreen-Wiederholung und Haltezeit sind begrenzt und erfordern die echte opt-in Bedienprobe", () => {
  for (const args of [
    ["--fullscreen-cycles", "1"], ["--fullscreen-hold", ".25"],
    ["--fullscreen-probe", "--fullscreen-cycles", "0"],
    ["--fullscreen-probe", "--fullscreen-cycles", "7"],
    ["--fullscreen-probe", "--fullscreen-cycles", "1.5"],
    ["--fullscreen-probe", "--fullscreen-hold", ".199"],
    ["--fullscreen-probe", "--fullscreen-hold", "3.001"],
    ["--fullscreen-probe", "--fullscreen-hold", "nan"],
    ["--fullscreen-probe", "--fullscreen-hold", "inf"],
  ]) {
    const result=spawnSync("python3",["scripts/measure-player.py","--label","invalid-fullscreen","--plan","interaction",...args],{cwd:path.join(__dirname,".."),encoding:"utf8",timeout:3000});
    assert.equal(result.status,2,result.stdout+result.stderr);
    assert.match(result.stderr,/fullscreen-(cycles|hold)/);
    assert.equal(result.stdout,"","invalid configuration must fail before any device command");
  }
  const load=spawnSync("python3",["scripts/measure-player.py","--label","invalid-fullscreen","--plan","load","--fullscreen-probe","--fullscreen-cycles","6"],{cwd:path.join(__dirname,".."),encoding:"utf8",timeout:3000});
  assert.equal(load.status,2);assert.match(load.stderr,/fullscreen-probe requires the interaction plan/);
});

test("CLI-Deadline umfasst echte Fullscreen-Roundtrips und bleibt bei maximalem Diagnosebudget begrenzt",()=>{
  const script=`
import contextlib, importlib.util, io, json, pathlib, sys, tempfile
sys.path.insert(0,str(pathlib.Path("scripts").resolve()))
spec=importlib.util.spec_from_file_location("measure_player","scripts/measure-player.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
for switches, expected_copies in [([],47),(["--fullscreen-probe","--fullscreen-cycles","6","--fullscreen-hold",".25"],80),(["--fullscreen-probe","--fullscreen-cycles","6","--fullscreen-hold","3"],109)]:
 with tempfile.TemporaryDirectory(prefix="langform-fs-deadline-") as directory:
  copies=[0];clock=[-1];launch_paths=[]
  def now():
   clock[0]+=1;return clock[0]
  def command(args):
   if args[:3]==["device","process","launch"]:
    target=pathlib.Path(args[args.index("--json-output")+1]);launch_paths.append(target)
    target.write_text(json.dumps({"result":{"process":{"processIdentifier":12345}}}))
   elif args[:3]==["device","copy","from"]:
    copies[0]+=1;target=pathlib.Path(args[args.index("--destination")+1]);target.write_text(json.dumps({"event":"app-init","processID":12345})+"\\n")
   else:raise AssertionError("unexpected device action")
  m.command=command;m.time.monotonic=now;m.time.sleep=lambda _:None
  sys.argv=["measure-player","--label","deadline-test","--plan","interaction","--output",directory,*switches]
  try:
   try:
    with contextlib.redirect_stdout(io.StringIO()):m.main()
   except RuntimeError as error:
    assert "did not complete" in str(error)
   else:raise AssertionError("CLI deadline without completion must fail")
   assert copies[0]==expected_copies,(switches,copies)
   report=json.loads(next(pathlib.Path(directory).glob("*-summary.json")).read_text())
   assert report["terminalEventObserved"] is False and report["autoplayEvidence"] is False
   assert report["probeSucceeded"] is False and report["missingInteractionSteps"] == list(m.INTERACTION_STEPS)
  finally:
   for launch in launch_paths:launch.unlink(missing_ok=True)
print("FULLSCREEN_DEADLINE_OK")
`;
  const result=spawnSync("python3",["-c",script],{cwd:path.join(__dirname,".."),encoding:"utf8",timeout:10000});
  assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/FULLSCREEN_DEADLINE_OK/);
});

test("Trace-Kopien werden erst nach PID-Prüfung atomar ersetzt; leere, fremde und fehlerhafte Übertragungen erhalten die gültige Spur",()=>{
  const script=`
import importlib.util,json,pathlib,subprocess,sys,tempfile
sys.path.insert(0,str(pathlib.Path("scripts").resolve()))
spec=importlib.util.spec_from_file_location("measure_player","scripts/measure-player.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory(prefix="langform-atomic-trace-") as directory:
 trace=pathlib.Path(directory)/"valid.jsonl"
 original=json.dumps({"event":"app-init","processID":12345})+"\\n"
 trace.write_text(original)
 for mode in ["failed","timeout","empty","wrong-pid","invalid-json","valid"]:
  def command(args):
   target=pathlib.Path(args[args.index("--destination")+1]);assert target!=trace and target.parent==trace.parent
   if mode in ["failed","timeout","empty"]:target.write_bytes(b"")
   if mode=="failed":raise subprocess.CalledProcessError(1,args,stderr="copy truncated its destination")
   if mode=="timeout":raise subprocess.TimeoutExpired(args,20)
   if mode=="wrong-pid":target.write_text(json.dumps({"event":"app-init","processID":999})+"\\n")
   if mode=="invalid-json":target.write_text("{bad committed JSON}\\n")
   if mode=="valid":target.write_text(original+json.dumps({"event":"fullscreen-probe-opened"})+"\\n"+'{"partial')
  m.command=command
  try:rows=m.copy_current_trace(trace,12345)
  except (subprocess.CalledProcessError,subprocess.TimeoutExpired,ValueError):
   assert mode in ["failed","timeout","invalid-json"]
  else:
   if mode=="valid":assert len(rows)==2 and rows[-1]["event"]=="fullscreen-probe-opened"
   else:assert rows is None
  if mode!="valid":assert trace.read_text()==original,"last valid trace must survive all rejected copies"
  assert not list(pathlib.Path(directory).glob("*.copy")),"temporary copies are removed on every path"
print("ATOMIC_TRACE_OK")
`;
  const result=spawnSync("python3",["-c",script],{cwd:path.join(__dirname,".."),encoding:"utf8",timeout:10000});
  assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/ATOMIC_TRACE_OK/);
});

test("Nach drei Kopierfehlern erfolgt genau ein Idle-Fetch; ein weiterer Fehler liefert ehrlichen Teilreport und bewahrt JSONL",()=>{
  const script=`
import contextlib,importlib.util,io,json,pathlib,subprocess,sys,tempfile
sys.path.insert(0,str(pathlib.Path("scripts").resolve()))
spec=importlib.util.spec_from_file_location("measure_player","scripts/measure-player.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
for mode in ["recover","failed","wrong-pid"]:
 with tempfile.TemporaryDirectory(prefix="langform-idle-trace-") as directory:
  trace=pathlib.Path(directory)/"copy-probe.jsonl";copies=[0];launch_paths=[];sleeps=[]
  partial=json.dumps({"event":"app-init","processID":12345})+"\\n"+json.dumps({"event":"fullscreen-probe-started"})+"\\n"
  completion_rows=[{"event":"fullscreen-probe-opened"},{"event":"fullscreen-probe-inline"},{"event":"fullscreen-probe-finished"}]+[{"event":"player-probe-confirmed-"+step} for step in m.INTERACTION_STEPS]+[{"event":"player-probe-completed"}]
  complete=partial+"".join(json.dumps(row)+"\\n" for row in completion_rows)
  def command(args):
   if args[:3]==["device","process","launch"]:
    target=pathlib.Path(args[args.index("--json-output")+1]);launch_paths.append(target)
    target.write_text(json.dumps({"result":{"process":{"processIdentifier":12345}}}))
   elif args[:3]==["device","copy","from"]:
    copies[0]+=1;target=pathlib.Path(args[args.index("--destination")+1]);assert target!=trace
    if copies[0]==1:target.write_text(partial)
    elif 2<=copies[0]<=4 or mode=="failed":
     target.write_bytes(b"");assert trace.read_text()==partial
     raise subprocess.CalledProcessError(1,args,stderr="diagnostic stream busy")
    elif mode=="wrong-pid":target.write_text(json.dumps({"event":"app-init","processID":999})+"\\n")
    else:target.write_text(complete)
   else:raise AssertionError("unexpected device action")
  m.command=command;m.time.sleep=sleeps.append
  sys.argv=["measure-player","--label","copy-probe","--plan","interaction","--fullscreen-probe","--output",directory]
  error=None
  try:
   with contextlib.redirect_stdout(io.StringIO()):m.main()
  except RuntimeError as caught:error=caught
  finally:
   for launch in launch_paths:launch.unlink(missing_ok=True)
  report=json.loads((pathlib.Path(directory)/"copy-probe-summary.json").read_text())
  assert report["traceCopyIdleRecoveryAttempted"] is True and report["preservedCurrentProcessTrace"] is True
  assert not list(pathlib.Path(directory).glob("*.copy"))
  if mode=="recover":
   assert error is None and copies[0]==6 and trace.read_text()==complete
   assert report["traceCopyError"] is None and report["traceCopyFailureCount"]==3
   assert report["terminalEventObserved"] is True and report["diagnosticFullscreenProbeCompleted"] is True
  else:
   assert error is not None and copies[0]==5 and trace.read_text()==partial
   assert report["traceCopyError"] and report["traceCopyFailureCount"]==(4 if mode=="failed" else 3)
   assert report["terminalEventObserved"] is False and report["diagnosticFullscreenProbeCompleted"] is False
   assert report["events"]==["app-init","fullscreen-probe-started"],"failed copy cannot invent final markers"
print("IDLE_TRACE_OK")
`;
  const result=spawnSync("python3",["-c",script],{cwd:path.join(__dirname,".."),encoding:"utf8",timeout:10000});
  assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/IDLE_TRACE_OK/);
});

test("CLI meldet echte Probe-Timeouts, fehlende Schritte und unvollständige Fullscreenzyklen mit Fehlercode und bewahrt Teilspur/Report", () => {
  const steps = ["minimizePlaying", "pauseMini", "expandPaused", "minimizePaused", "resumeMini", "expandPlaying", "close", "verifyBlank"];
  const confirmed = steps.map(step => ({ event: "player-probe-confirmed-" + step }));
  const cycles = number => Array.from({ length: number }, () => [{ event: "fullscreen-probe-opened" }, { event: "fullscreen-probe-inline" }]).flat();
  const successful = [...confirmed, ...cycles(6), { event: "fullscreen-probe-finished" }, { event: "player-probe-completed" }];
  const playing = number => ({ event: "video-playing-report", scope: "video-load", request: number });
  const cases = [
    { name: "screen-time", rows: [{ event: "video-probe-timeout" }], failure: true, terminal: true, reason: "video-probe-timeout" },
    { name: "step-timeout", rows: [...confirmed.slice(0, 2), { event: "player-probe-timeout-expandPaused" }], failure: true, terminal: true, reason: "player-probe-timeout-expandPaused" },
    { name: "fullscreen-timeout", rows: [...confirmed.slice(0, 6), ...cycles(5), { event: "fullscreen-probe-timeout" }], failure: true, terminal: true, reason: "fullscreen-probe-timeout" },
    { name: "fullscreen-cancelled", rows: [...successful, { event: "fullscreen-probe-cancelled" }], failure: true, terminal: true, reason: "fullscreen-probe-cancelled" },
    { name: "missing-confirmation", rows: [...successful.filter(row => row.event !== "player-probe-confirmed-verifyBlank")], failure: true, terminal: true, reason: "Missing confirmed interaction steps: verifyBlank" },
    { name: "short-fullscreen", rows: [...confirmed, ...cycles(1), { event: "fullscreen-probe-finished" }, { event: "player-probe-completed" }], failure: true, terminal: true, reason: "observed 1 opened and 1 inline", fullscreenComplete: false },
    { name: "missing-inline", rows: [...successful.filter((row, index) => index !== confirmed.length + 1)], failure: true, terminal: true, reason: "observed 6 opened and 5 inline", fullscreenComplete: false },
    { name: "deadline", rows: [], failure: true, terminal: false, reason: "Interaction probe did not complete" },
    { name: "completed", rows: successful, failure: false, terminal: true, fullscreenComplete: true },
    { name: "load-timeout-before-finish", plan: "load", rows: [{ event: "video-probe-timeout" }, playing(2), { event: "video-probe-finished" }], failure: true, terminal: true, reason: "video-probe-timeout" },
    { name: "load-missing-request", plan: "load", rows: [playing(2), { event: "video-probe-finished" }], failure: true, terminal: true, reason: "Missing playing reports for video requests: 1" },
    { name: "load-completed", plan: "load", rows: [playing(1), playing(2), { event: "video-probe-finished" }], failure: false, terminal: true },
  ];
  const script = `
import importlib.util,json,pathlib,sys
sys.path.insert(0,str(pathlib.Path("scripts").resolve()))
spec=importlib.util.spec_from_file_location("measure_player","scripts/measure-player.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
case=json.loads(sys.argv[1]);directory=pathlib.Path(sys.argv[2]);pid=12345
trace="".join(json.dumps(row)+"\\n" for row in [{"event":"app-init","processID":pid}]+case["rows"])
launch_paths=[];clock=[-1]
def now():
 clock[0]+=1;return clock[0]
def command(args):
 if args[:3]==["device","process","launch"]:
  target=pathlib.Path(args[args.index("--json-output")+1]);launch_paths.append(target)
  target.write_text(json.dumps({"result":{"process":{"processIdentifier":pid}}}))
 elif args[:3]==["device","copy","from"]:
  pathlib.Path(args[args.index("--destination")+1]).write_text(trace)
 else:raise AssertionError("No build/install/play/retry allowed: "+str(args))
m.command=command;m.time.monotonic=now;m.time.sleep=lambda _:None
sys.argv=["measure-player","--label","cli-result","--plan",case.get("plan","interaction"),"--output",str(directory)]
if case.get("plan")!="load":sys.argv.extend(["--fullscreen-probe","--fullscreen-cycles","6","--fullscreen-hold",".25"])
try:m.main()
finally:
 for launch in launch_paths:launch.unlink(missing_ok=True)
`;
  for (const scenario of cases) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "langform-cli-outcome-"));
    try {
      const result = spawnSync("python3", ["-c", script, JSON.stringify(scenario), directory], {
        cwd: path.join(__dirname, ".."), encoding: "utf8", timeout: 10000,
      });
      assert.equal(result.error, undefined, scenario.name + ": " + result.error);
      assert.equal(result.status, scenario.failure ? 1 : 0, scenario.name + ": " + result.stdout + result.stderr);
      const report = JSON.parse(fs.readFileSync(path.join(directory, "cli-result-summary.json"), "utf8"));
      assert.equal(report.probeSucceeded, !scenario.failure, scenario.name);
      assert.equal(report.terminalEventObserved, scenario.terminal, scenario.name);
      assert.equal(report.preservedCurrentProcessTrace, true, scenario.name);
      assert.equal(report.autoplayEvidence, false, scenario.name);
      if (scenario.reason) assert.ok(report.probeFailureReasons.some(reason => reason.includes(scenario.reason)), scenario.name + ": " + JSON.stringify(report.probeFailureReasons));
      if (scenario.fullscreenComplete !== undefined) assert.equal(report.diagnosticFullscreenProbeCompleted, scenario.fullscreenComplete, scenario.name);
      const rows = fs.readFileSync(path.join(directory, "cli-result.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
      assert.deepEqual(rows, [{ event: "app-init", processID: 12345 }, ...scenario.rows], "the actual partial/final trace is retained without invented markers: " + scenario.name);
      const finalOutput = JSON.parse(result.stdout.trim().split("\n").at(-1));
      assert.equal(finalOutput.probeSucceeded, !scenario.failure, scenario.name);
      assert.deepEqual(finalOutput.probeFailureReasons, report.probeFailureReasons, scenario.name);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }
});
