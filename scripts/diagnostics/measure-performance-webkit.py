#!/usr/bin/env python3
"""Live macOS WebKit measurements with the iPhone's shipping JS and mobile UA."""
import argparse
import json
import re
import subprocess
import tempfile
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--caption-track-experiment', action='store_true', help='QA only: test track deselection while retaining the original captions module')
parser.add_argument('--first-enable', action='store_true')
parser.add_argument('--module-preload-experiment', action='store_true')
parser.add_argument('--actions-file', type=Path, help='QA-only custom public-video actions')
args = parser.parse_args()
repo = Path(__file__).resolve().parents[2]
source = (repo / 'ios/Langform/Langform/YouTubeWebView.swift').read_text()
names = []
for field in ['playerEarlyScriptNames', 'scriptNames', 'playerScriptNames']:
    names += re.findall(r'"([^"]+)"', re.search(r'static let '+field+r' = \[([^\]]+)\]', source).group(1))
bootstrap = "window.__langformFullscreenEnterProtocol=1;window.__langformFullscreenExitProtocol=1;['langformPlayer','langformOverlayState','langformNavigate','langformFullscreen'].forEach(function(n){window.webkit.messageHandlers[n]={postMessage:function(){}};});\n"
if args.module_preload_experiment: bootstrap += 'window.__lfModulePreloadExperiment=true;\n'
scripts = []
for name in names:
    path = repo / 'ios/Langform/Langform' / (name+'.js')
    if not path.exists(): path = repo / 'extension/src' / (name+'.js')
    script = path.read_text()
    if name == 'page-captions':
        for fn in ['ensureAirPlay', 'refreshChapters', 'findSeekBar', 'playerControls', 'controlLine', 'chaptersFromPlayer']:
            replacement = ('function '+fn+'(){var t=performance.now();try{return __lf_original_'+fn+'.apply(this,arguments);}finally{window.__lfRecordFunction('+json.dumps(fn)+',performance.now()-t);}}\n  function __lf_original_'+fn+'(')
            script = script.replace('function '+fn+'(', replacement)
    scripts.append('window.__lfProfileSource='+json.dumps(name)+';\n'+script+'\nwindow.__lfProfileSource="";\n')
args.output.parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='langform-performance-') as folder:
    folder = Path(folder)
    bundle = folder / 'shipping.js'; bundle.write_text(bootstrap+'\n'.join(scripts))
    runner = folder / 'live'
    actions = args.actions_file or repo / ('scripts/diagnostics/FirstCaptionActions.js' if args.first_enable else 'scripts/diagnostics/PerformanceActions.js')
    if args.caption_track_experiment:
        experimental = actions.read_text().replace('var initial = root.isSubtitlesOn(), results = [];', 'var initial = root.isSubtitlesOn(), results = [], savedTrack = root.getOption("captions", "track");')
        experimental = experimental.replace('button.click();\n    var commandMs', 'if (!expected) savedTrack = root.getOption("captions", "track"); if (index === 0 && expected) button.click(); else root.setOption("captions", "track", expected ? savedTrack : {});\n    var commandMs')
        experimental = experimental.replace("passed: root.isSubtitlesOn() === expected &&", "passed: button.getAttribute('aria-pressed') === String(expected) && root.isSubtitlesOn() === expected &&")
        actions = folder / 'experiment.js'; actions.write_text(experimental)
    subprocess.run(['xcrun', 'swiftc', str(repo / 'scripts/diagnostics/CaptionsLiveWebKit.swift'), '-o', str(runner)], check=True)
    with args.output.open('w') as output:
        result = subprocess.run([str(runner), str(repo / 'ios/Langform/Langform/SilentDiagnostics.js'), str(repo / 'scripts/diagnostics/PerformanceProbe.js'), str(bundle), str(actions)], stdout=output, timeout=65)
    print(args.output.read_text())
    raise SystemExit(result.returncode)
