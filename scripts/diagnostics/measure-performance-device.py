#!/usr/bin/env python3
"""Measure fixed public-video startup and caption latency on SrTan, preserving data."""
import argparse
import json
import subprocess
import time
from pathlib import Path
from trace import read_trace_rows

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--label', required=True)
parser.add_argument('--first-enable', action='store_true')
parser.add_argument('--output', type=Path, default=Path('docs/qa/performance-2026-10-11'))
args = parser.parse_args()
device = '00008160-001234D11440000A'
bundle = 'de.ipekkaya.langform'
args.output.mkdir(parents=True, exist_ok=True)
launch = args.output / (args.label+'-launch.json')
target = args.output / (args.label+'.jsonl')
env = {'LANGFORM_DIAGNOSTICS':'1', 'LANGFORM_VIDEO_PROBE':'["M7lc1UVf-VE"]', 'LANGFORM_PERFORMANCE_PROBE':'1', 'LANGFORM_PLAYER_TRACE':'1'}
if args.first_enable: env['LANGFORM_FIRST_CAPTION_PROBE'] = '1'
def run(*a): subprocess.run(['xcrun', 'devicectl', *a], check=True, stdout=subprocess.DEVNULL, timeout=25)
run('device','process','launch','--device',device,'--terminate-existing','--environment-variables',json.dumps(env),'--json-output',str(launch),'--timeout','15',bundle)
pid=json.loads(launch.read_text())['result']['process']['processIdentifier']
for attempt in range(15):
    time.sleep(2)
    try:
        run('device','copy','from','--device',device,'--domain-type','appDataContainer','--domain-identifier',bundle,'--source','Library/Caches/langform-startup.jsonl','--destination',str(target))
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        continue  # A transient CoreDevice file-transfer error is not app latency.
    rows=read_trace_rows(target)
    if not rows or rows[0].get('processID') != pid: continue
    if any(r.get('event')=='performance-probe' and r.get('finished') for r in rows): break
else: raise RuntimeError('No completed current-process performance probe')
perf=[r for r in rows if r.get('event')=='performance-probe']
report={'label':args.label,'pid':pid,'build':rows[0].get('build'),'configuration':rows[0]['configuration'],'conditions':'actual SrTan WKWebView, diagnostic DOM clicks, persistent website data, no debugger','performance':perf,'video':[r for r in rows if r.get('scope')=='video-load' and r.get('event')!='performance-probe']}
(args.output/(args.label+'-summary.json')).write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
raise SystemExit(0 if perf[-1].get('passed') else 1)
