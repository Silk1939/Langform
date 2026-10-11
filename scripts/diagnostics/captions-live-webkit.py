#!/usr/bin/env python3
"""Test the shipping iPhone scripts against a public live YouTube player in macOS WebKit.

Uses an isolated silent session, no account data, fixed M7lc1UVf-VE video and six
original-button clicks. Assertions use the actual player API and caption DOM.
"""
import argparse
import hashlib
import json
import re
import subprocess
import tempfile
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--without-fix', action='store_true')
args = parser.parse_args()
repo = Path(__file__).resolve().parents[2]
swift = repo / 'ios/Langform/Langform/YouTubeWebView.swift'
names = []
for field in ['playerEarlyScriptNames', 'scriptNames', 'playerScriptNames']:
    names += re.findall(r'"([^"]+)"', re.search(r'static let '+field+r' = \[([^\]]+)\]', swift.read_text()).group(1))
if args.without_fix:
    names.remove('CaptionToggle')
sources = []
for name in names:
    path = repo / 'ios/Langform/Langform' / (name+'.js')
    if not path.exists():
        path = repo / 'extension/src' / (name+'.js')
    sources.append(path)
bootstrap = '''window.__langformFullscreenEnterProtocol=1;window.__langformFullscreenExitProtocol=1;
['langformPlayer','langformOverlayState','langformNavigate','langformFullscreen'].forEach(function(name){window.webkit.messageHandlers[name]={postMessage:function(){}};});
'''
args.output.parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='langform-caption-webkit-') as temporary:
    temporary = Path(temporary)
    bundle = temporary / 'shipping.js'
    bundle.write_text(bootstrap + '\n'.join(path.read_text() for path in sources))
    runner = temporary / 'live'
    subprocess.run(['xcrun', 'swiftc', str(repo / 'scripts/diagnostics/CaptionsLiveWebKit.swift'), '-o', str(runner)], check=True)
    with args.output.open('w') as output:
        result = subprocess.run([str(runner), str(repo / 'ios/Langform/Langform/SilentDiagnostics.js'), str(bundle), str(repo / 'ios/Langform/Langform/CaptionDiagnostics.js')], stdout=output, timeout=65)
    rows = [json.loads(line) for line in args.output.read_text().splitlines()]
    summary = {'engine': 'macOS WKWebView live public YouTube, mobile Safari UA, no iPhone touches',
               'withoutFix': args.without_fix, 'exitCode': result.returncode,
               'passed': bool(rows and rows[-1].get('finished') and rows[-1].get('passed')),
               'sourceSHA256': {str(path.relative_to(repo)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sources}}
    args.output.with_suffix('.summary.json').write_text(json.dumps(summary, indent=2)+'\n')
    print(json.dumps(summary))
    raise SystemExit(0 if summary['passed'] else 1)
