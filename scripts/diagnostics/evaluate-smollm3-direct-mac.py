#!/usr/bin/env python3
"""One isolated native full-source SmolLM3 QA call; no app/provider changes."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
QA = ROOT / 'docs/qa/smollm3-direct-2026-10-19'
EXPERIMENT_SHA = '6ade97c2ab13def6dabfd7261bcd9c0f6eca4386060df23827b80188ffc88be5'


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(4 * 1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--fixture', type=Path)
    args = parser.parse_args()
    experiment_path = QA / 'experiment.json'
    assert digest(experiment_path) == EXPERIMENT_SHA
    e = json.loads(experiment_path.read_text())
    shared_path = ROOT / 'scripts/diagnostics/evaluate-smollm3-mac.py'
    assert digest(shared_path) == e['sharedRunnerSHA256']
    spec = importlib.util.spec_from_file_location('frozen_smol_runtime', shared_path)
    shared = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(shared)
    assert shared.SAMPLING == e['sampling']
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    assert not any(output.iterdir()), 'Use a new empty evidence directory'
    shutil.copyfile(experiment_path, output / 'experiment.json')
    shutil.copyfile(shared_path, output / shared_path.name)
    shutil.copyfile(Path(__file__), output / Path(__file__).name)
    runtime = json.loads((QA / e['runtimeIdentity']).resolve().read_text())
    model = json.loads((QA / e['modelManifest']).resolve().read_text())
    binary, model_path = Path(runtime['binary']), Path(model['localFile'])
    assert model['integrityVerified'] and digest(binary) == runtime['binarySHA256']
    assert model_path.stat().st_size == model['bytes'] and digest(model_path) == model['sha256']
    history = ROOT / 'docs/qa/smollm3-2026-10-19/mac8k-valid-schema'
    previous = json.loads((history / 'manifest.json').read_text())
    helper = history / 'contract-build/SmolSummaryContract'
    assert digest(helper) == previous['contractBinarySHA256']
    assert all(digest(v['originalPath']) == digest(v['compiledPath']) == v['sha256'] for v in previous['sourceSnapshot'].values())
    source = (args.fixture or (ROOT / e['firstFixture'])).resolve()
    allowed = {(ROOT / p).resolve() for p in [e['firstFixture']] + e['additionalFixturesOnlyAfterIndependentFirstPass']}
    assert source in allowed
    prepared_result = subprocess.run([str(helper)], input=json.dumps({'operation':'prepare','sourcePath':str(source)}), text=True, capture_output=True, check=True)
    prepared = json.loads(prepared_result.stdout)
    assert prepared['sourceReconstructedExactly'] and prepared['sourceSHA256'] == digest(source)
    prepared_source = prepared['preparedSource']
    user = e['userPrefix'] + prepared_source + e['userSuffix']
    messages = [{'role':'system','content':e['system']},{'role':'user','content':user}]
    schema_json = e['outputSchemaJSON']
    schema = json.loads(schema_json)
    assert shared.property_orders(schema) == {'$':['tldr','points','takeaway']}
    report = {'schemaVersion':1,'status':'preparing','formatComplete':False,'semanticAcceptance':False,
        'physicalDevice':False,'productProviderRoute':False,'experimentSHA256':EXPERIMENT_SHA,
        'runnerSHA256':digest(Path(__file__)),'sharedRunnerSHA256':digest(shared_path),
        'runtime':runtime,'model':model,'sourcePath':str(source),'sourceSHA256':digest(source),
        'preparedSHA256':prepared['preparedSHA256'],'sourceBytes':prepared['sourceBytes'],
        'preparedBytes':prepared['preparedBytes'],'sourceReconstructedExactly':True,
        'preparationHelperPath':str(helper),'preparationHelperBinarySHA256':digest(helper),
        'preparationProductSources':previous['sourceSnapshot'],
        'oldModelPromptsUsed':False,'selectionStages':0,'correctionStages':0,
        'contextTokens':e['contextTokens'],'outputTokenLimit':e['outputTokenLimit'],
        'sampling':e['sampling'],'nativeInferenceRequested':False,'nativeInferencePerformed':False,
        'memoryLimitInterpretation':'Mac CPU external process only; RSS and physical footprint separate; no physical iPhone fit claim.'}
    (output / 'source.txt').write_bytes(source.read_bytes())
    (output / 'prepared-source.txt').write_text(prepared_source)
    (output / 'schema-original.json').write_text(schema_json)
    shared.save(output / 'messages.json', messages)
    shared.save(output / 'result.json', report)
    server = None
    started = time.monotonic()
    try:
        server = shared.Server(binary, model_path, e['contextTokens'], output, report)
        rendered = server.request('/apply-template', {'messages':messages,'chat_template_kwargs':{'enable_thinking':False},'add_generation_prompt':True})['prompt']
        tokens = server.request('/tokenize',{'content':rendered,'add_special':True,'parse_special':True})['tokens']
        assistant_tail = rendered.rsplit('<|im_start|>assistant\n',1)[-1]
        checks = {'fullSourceRetained':prepared_source in rendered,'fullUserRetained':user in rendered,
            'fullSystemRetained':e['system'].removesuffix(' /no_think') in rendered,
            'systemUserBoundaryClosed':rendered.split('<|im_start|>user',1)[0].rstrip().endswith('<|im_end|>'),
            'renderedNoThinkingMode':'Reasoning Mode: /no_think' in rendered,
            'closedNonthinkingAssistantPrefix':''.join(assistant_tail.split()) == '<think></think>',
            'fullPromptFits':len(tokens)+e['outputTokenLimit']<=e['contextTokens'],
            'actualContext8192':report['serverSlots'][0]['n_ctx']==e['contextTokens']==8192}
        report.update(promptTokens=len(tokens),promptSHA256=hashlib.sha256(rendered.encode()).hexdigest(),preflightChecks=checks,schemaPropertyOrders=shared.property_orders(schema))
        (output / 'rendered-prompt.txt').write_text(rendered)
        shared.save(output / 'prompt-token-ids.json',tokens)
        shared.save(output / 'result.json',report)
        if not all(checks.values()):
            raise RuntimeError('Full-source/template/context preflight failed; no native generation requested')
        report['slotEraseBeforeGeneration'] = server.request('/slots/0?action=erase',{})
        request = {'prompt':tokens,'n_predict':e['outputTokenLimit'],'json_schema':schema,
            'cache_prompt':False,'stream':False,'return_tokens':True,'id_slot':0,'ignore_eos':False,**e['sampling']}
        shared.save(output / 'request.json',request)
        report['nativeInferenceRequested'] = True
        shared.save(output / 'result.json',report)
        inference_start = time.monotonic()
        response = server.request('/completion',request)
        report['nativeWallSeconds'] = time.monotonic()-inference_start
        report['nativeInferencePerformed'] = bool(response.get('tokens_predicted') or response.get('content'))
        report.update(stopType=response.get('stop_type'),truncated=response.get('truncated'),
            tokensEvaluated=response.get('tokens_evaluated'),tokensPredicted=response.get('tokens_predicted'),timings=response.get('timings'))
        shared.save(output / 'response.json',response)
        text = response['content']
        (output / 'output.txt').write_text(text)
        grammar = response['generation_settings']['grammar']
        root_rule = next(line for line in grammar.splitlines() if line.startswith('root ::='))
        positions = [root_rule.index(key+'-kv') for key in ['tldr','points','takeaway']]
        native_checks = {'eos':response.get('stop_type')=='eos','notTruncated':response.get('truncated') is False,
            'actualInputCountExact':response.get('tokens_evaluated')==len(tokens),
            'nativeGrammarPropertyOrder':positions==sorted(positions)}
        report.update(nativeChecks=native_checks,actualNativeGrammarRoot=root_rule)
        doc = json.loads(text)
        format_checks = {'exactKeysAndOrder':list(doc)==['tldr','points','takeaway'],
            'tldrNonempty':isinstance(doc.get('tldr'),str) and bool(doc['tldr'].strip()),
            'takeawayNonempty':isinstance(doc.get('takeaway'),str) and bool(doc['takeaway'].strip()),
            'threeToFiveNonemptyStringPoints':isinstance(doc.get('points'),list) and 3<=len(doc['points'])<=5 and all(isinstance(p,str) and p.strip() for p in doc['points'])}
        report['formatChecks'] = format_checks
        report['formatComplete'] = all(native_checks.values()) and all(format_checks.values())
        report['document'] = doc
        words = ' '.join([doc['tldr']]+doc['points']+[doc['takeaway']]).split()
        report.update(wordCount=len(words),requestedWordRangeMet=100<=len(words)<=160)
        report['status'] = 'native_completed_pending_semantic_review' if report['formatComplete'] else 'native_completed_format_failed'
    except Exception as error:
        report.update(status='failed',error=repr(error))
    finally:
        if server:
            server.close()
        report['elapsedSeconds'] = time.monotonic()-started
        report['sixProductSourcesUnchanged'] = all(digest(v['originalPath'])==v['sha256'] for v in previous['sourceSnapshot'].values())
        report['sharedRunnerUnchanged'] = digest(shared_path)==e['sharedRunnerSHA256']
        report['experimentUnchanged'] = digest(experiment_path)==EXPERIMENT_SHA
        shared.save(output / 'result.json',report)
        print(json.dumps({k:report.get(k) for k in ['status','formatComplete','promptTokens','tokensPredicted','elapsedSeconds','kernelLifetimeMaxPhysicalFootprintBytes','peakObservedResidentBytes','serverReturnCode','serverProcessEnded']}),flush=True)
    return 0 if report['formatComplete'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
