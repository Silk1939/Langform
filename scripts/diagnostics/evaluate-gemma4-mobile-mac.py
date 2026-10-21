#!/usr/bin/env python3
"""One isolated native full-source Gemma4 E4B QAT-Mobile QA call; no app/provider changes."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import socket
import threading
from urllib.error import HTTPError, URLError
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
QA = ROOT / 'docs/qa/gemma4-mobile-2026-10-19'
EXPERIMENT_SHA = '72ea9bb2aab5c7a5f3e18b3207605a2c25da7f0f6ac4e47e17850c0deb755311'


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(4 * 1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def create_gemma_server(shared, binary, model, context, directory, report, experiment):
    """Gemma4-specific startup; reuse frozen CPU process sampling/HTTP/cleanup only."""
    class GemmaServer(shared.Server):
        def __init__(self):
            self.directory, self.report = directory, report
            self.started = time.monotonic()
            self.stop = threading.Event()
            self.samples = []
            slots = directory / 'owned-slot-cache'
            slots.mkdir()
            report.update(peakObservedPhysicalFootprintBytes=0, peakObservedResidentBytes=0,
                kernelLifetimeMaxPhysicalFootprintBytes=0,
                memoryMethod='Darwin proc_pid_rusage V0 current + V4 lifetime peak;100ms')
            with socket.socket() as listener:
                listener.bind(('127.0.0.1',0))
                port = listener.getsockname()[1]
            self.url = 'http://127.0.0.1:' + str(port)
            self.command = [str(binary),'--model',str(model),'--ctx-size',str(context),
                '--parallel','1','--no-context-shift','--no-repack','--load-mode','mmap',
                '--device','none','--n-gpu-layers','0','--no-op-offload','--fit','off',
                '--threads','4','--threads-batch','4','--batch-size','256','--ubatch-size','256',
                '--cache-ram','0','--no-cache-idle-slots','--host','127.0.0.1','--port',str(port),
                '--slot-save-path',str(slots),'--no-webui','--offline','--no-mmproj','--jinja',
                '--reasoning','off','--chat-template-kwargs','{"enable_thinking":false}','--perf']
            if experiment.get('chatTemplateFile'):
                template = (QA / experiment['chatTemplateFile']).resolve()
                assert digest(template)==experiment['chatTemplateSHA256']
                self.command.extend(['--chat-template-file',str(template)])
            report['serverCommand'] = self.command
            self.log = (directory / 'runtime.log').open('w')
            self.process = subprocess.Popen(self.command,stdout=self.log,stderr=subprocess.STDOUT)
            report['serverPID'] = self.process.pid
            self.sampler = threading.Thread(target=self.sample,daemon=True)
            self.sampler.start()
            try:
                deadline = time.monotonic()+90
                while time.monotonic()<deadline:
                    if self.process.poll() is not None:
                        raise RuntimeError('Native server exited during initialization; see runtime.log')
                    try:
                        self.request('/health',timeout=1)
                        report['engineReadySeconds'] = time.monotonic()-self.started
                        report['serverProps'] = self.request('/props')
                        report['serverSlots'] = self.request('/slots')
                        return
                    except (HTTPError,URLError,TimeoutError):
                        time.sleep(0.1)
                raise TimeoutError('Native initialization exceeded90 seconds')
            except Exception:
                self.close()
                raise
    return GemmaServer()


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
    spec = importlib.util.spec_from_file_location('frozen_cpu_runtime', shared_path)
    shared = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(shared)
    assert '/no_think' not in e['system']
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
        'modelChatFormat':'Canonical Google Gemma4 turns with BOS rendered once; enable_thinking=false, add_special=false, parse_special=true',
        'tokenizationRequest':{'add_special':False,'parse_special':True},
        'nativeExpectedEOGTokenIDs':[1,106,50],'manualStopStringsAdded':False,
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
        server = create_gemma_server(shared, binary, model_path, e['contextTokens'], output, report, e)
        api_rendered = server.request('/apply-template', {'messages':messages,'add_generation_prompt':True,'chat_template_kwargs':{'enable_thinking':False}})['prompt']
        (output / 'apply-template-raw-prompt.txt').write_text(api_rendered)
        canonical_template = (QA / e['chatTemplateFile']).read_text()
        header_path = QA / 'gguf-header-audit.json'
        header = json.loads(header_path.read_text())
        assert header['fileExpectedSHA256']==model['sha256']
        assert header['metadata']['general.architecture']=='gemma4'
        assert header['metadata']['tokenizer.ggml.add_bos_token'] is True
        expected_render = '<bos><|turn>system\n' + e['system'].strip() + '<turn|>\n<|turn>user\n' + user.strip() + '<turn|>\n<|turn>model\n'
        # b11729 common/chat.cpp938 removes a rendered BOS when the model's
        # add_bos is true, expecting later string tokenization to add it. Our
        # explicit integer prompt preserves the canonical BOS exactly once.
        assert report['serverProps']['bos_token']=='<bos>'
        assert api_rendered==expected_render[len('<bos>'):]
        rendered = '<bos>' + api_rendered
        transport_audit = {'apiRawPromptSHA256':hashlib.sha256(api_rendered.encode()).hexdigest(),
            'finalCanonicalPromptSHA256':hashlib.sha256(rendered.encode()).hexdigest(),
            'canonicalTemplateRawSHA256':digest(QA / e['chatTemplateFile']),
            'actualPropsTemplateSHA256':hashlib.sha256(report['serverProps']['chat_template'].encode()).hexdigest(),
            'propsTemplateExactCanonicalWithOnlyTrailingLFRemoved':report['serverProps']['chat_template']==canonical_template.rstrip('\n'),
            'removedCanonicalTrailingLFCount':len(canonical_template)-len(canonical_template.rstrip('\n')),
            'ggufAddBOS':True,'ggufHeaderAuditSHA256':digest(header_path),
            'rawRenderExactlyCanonicalWithoutOneBOS':api_rendered==expected_render[len('<bos>'):],
            'oneCanonicalBOSRestored':True,'finalCanonicalRenderExact':rendered==expected_render,
            'add_special':False,'parse_special':True,
            'justification':'Pinned b11729 common/chat.cpp938-944 removes rendered BOS if model add_bos=true; integer /completion prompts do not add BOS.'}
        report['transportNormalization'] = transport_audit
        shared.save(output / 'transport-normalization-audit.json',transport_audit)
        tokens = server.request('/tokenize',{'content':rendered,'add_special':False,'parse_special':True})['tokens']
        prefix = '<|turn>model\n'
        prefix_tokens = server.request('/tokenize',{'content':prefix,'add_special':False,'parse_special':True})['tokens']
        decoded_prefix = server.request('/detokenize',{'tokens':prefix_tokens})['content']
        report['assistantPrefixNativeTokens'] = prefix_tokens
        report['assistantPrefixNativeDetokenized'] = decoded_prefix
        expected_render = '<bos><|turn>system\n' + e['system'].strip() + '<turn|>\n<|turn>user\n' + user.strip() + '<turn|>\n<|turn>model\n'
        checks = {'fullSourceRetained':prepared_source in rendered,'fullUserRetained':user in rendered,
            'fullSystemRetained':e['system'] in rendered,
            'exactOfficialGemma4Render':rendered==expected_render,
            'actualPropsTemplateMatchesPinned':report['serverProps']['chat_template']==canonical_template.rstrip('\n'),
            'systemUserBoundaryClosed':rendered.split('<|turn>user\n',1)[0].endswith('<turn|>\n'),
            'assistantPrefixCorrect':rendered.endswith('<turn|>\n<|turn>model\n'),
            'thinkingDisabled':'<|think|>' not in rendered and '<|channel>thought' not in rendered,
            'noForeignTemplateControls':'<|im_start|>' not in rendered and '/no_think' not in rendered and '<|assistant|>' not in rendered,
            'exactlyOneRenderedBOS':tokens[0]==2 and tokens.count(2)==1 and rendered.count('<bos>')==1,
            'nativeAssistantPrefixExact':tokens[-len(prefix_tokens):]==prefix_tokens and decoded_prefix==prefix,
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
