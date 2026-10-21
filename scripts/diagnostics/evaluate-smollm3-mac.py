#!/usr/bin/env python3
"""Actual CPU llama.cpp evaluation; no product edits, cloud, or recorded inference."""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
QA = ROOT / "docs/qa/smollm3-2026-10-19"
FILES = ["OnDeviceSummary.swift", "GemmaSummaryPolicy.swift", "GemmaEvidence.swift",
         "GemmaSummaryDocument.swift", "GemmaClaimValidation.swift", "GemmaSummaryRepair.swift"]
SAMPLING = {"temperature": 0.6, "top_p": 0.95, "top_k": 40, "min_p": 0.0,
            "repeat_penalty": 1.0, "seed": 42}


def property_orders(value, path="$", result=None):
    result = {} if result is None else result
    if isinstance(value, dict):
        if "properties" in value:
            result[path] = list(value["properties"])
        for key, item in value.items():
            property_orders(item, path + "." + key, result)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            property_orders(item, path + "[" + str(index) + "]", result)
    return result


def sha(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for b in iter(lambda: f.read(4 * 1024 * 1024), b""):
            h.update(b)
    return h.hexdigest()


def save(path, value):
    path = Path(path)
    pending = path.with_suffix(path.suffix + ".pending")
    pending.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")
    pending.replace(path)


class ContextTooLarge(Exception):
    pass


class Server:
    def __init__(self, binary, model, context, directory, report):
        self.directory, self.report = directory, report
        self.started = time.monotonic()
        self.stop = threading.Event()
        self.samples = []
        slots = directory / "owned-slot-cache"
        slots.mkdir()
        report.update({"peakObservedPhysicalFootprintBytes": 0, "peakObservedResidentBytes": 0,
                       "kernelLifetimeMaxPhysicalFootprintBytes": 0,
                       "memoryMethod": "Darwin proc_pid_rusage V0 current + V4 lifetime peak;100ms"})
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        self.url = "http://127.0.0.1:" + str(port)
        self.command = [str(binary), "--model", str(model), "--ctx-size", str(context),
            "--parallel", "1", "--no-context-shift", "--no-repack", "--load-mode", "mmap",
            "--device", "none", "--n-gpu-layers", "0", "--no-op-offload", "--fit", "off",
            "--threads", "4", "--threads-batch", "4", "--batch-size", "256", "--ubatch-size", "256",
            "--cache-ram", "0", "--no-cache-idle-slots", "--host", "127.0.0.1", "--port", str(port),
            "--slot-save-path", str(slots),
            "--chat-template-file", str(QA / "chat-template-system-boundary-fixed.jinja"),
            "--no-webui", "--offline", "--no-mmproj", "--jinja", "--reasoning", "off",
            "--chat-template-kwargs", '{"enable_thinking":false}', "--perf"]
        report["serverCommand"] = self.command
        self.log = (directory / "runtime.log").open("w")
        self.process = subprocess.Popen(self.command, stdout=self.log, stderr=subprocess.STDOUT)
        report["serverPID"] = self.process.pid
        self.sampler = threading.Thread(target=self.sample, daemon=True)
        self.sampler.start()
        try:
            deadline = time.monotonic() + 90
            while time.monotonic() < deadline:
                if self.process.poll() is not None:
                    raise RuntimeError("Native server exited during initialization; see runtime.log")
                try:
                    self.request("/health", timeout=1)
                    report["engineReadySeconds"] = time.monotonic() - self.started
                    report["serverProps"] = self.request("/props")
                    report["serverSlots"] = self.request("/slots")
                    return
                except (HTTPError, URLError, TimeoutError):
                    time.sleep(0.1)
            raise TimeoutError("Native initialization exceeded 90 seconds")
        except Exception:
            self.close()
            raise

    def request(self, path, value=None, timeout=240):
        request = Request(self.url + path, data=None if value is None else json.dumps(value).encode(),
                          headers={"Content-Type": "application/json"})
        with urlopen(request, timeout=timeout) as response:
            return json.load(response)

    def sample(self):
        lib = ctypes.CDLL("/usr/lib/libproc.dylib")
        # rusage_info_v0: UUID16 followed by10 UInt64 fields. The platform SDK
        # defines resident_size as index6 and phys_footprint as index7.
        lib.proc_pid_rusage.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
        lib.proc_pid_rusage.restype = ctypes.c_int
        while not self.stop.is_set():
            buffer = ctypes.create_string_buffer(96)
            if lib.proc_pid_rusage(self.process.pid, 0, ctypes.byref(buffer)) == 0:
                values = struct.unpack_from("10Q", buffer.raw, 16)
                row = {"elapsedSeconds": time.monotonic() - self.started,
                    "residentBytes": values[6], "physicalFootprintBytes": values[7]}
                # SDK rusage_info_v4 is296 bytes; lifetime max phys footprint
                # is UInt64 at byte240. A kernel peak includes sub-sample spikes.
                extended = ctypes.create_string_buffer(296)
                if lib.proc_pid_rusage(self.process.pid, 4, ctypes.byref(extended)) == 0:
                    lifetime_peak = struct.unpack_from("Q", extended.raw, 240)[0]
                    row["kernelLifetimeMaxPhysicalFootprintBytes"] = lifetime_peak
                    self.report["kernelLifetimeMaxPhysicalFootprintBytes"] = max(
                        self.report["kernelLifetimeMaxPhysicalFootprintBytes"], lifetime_peak)
                self.samples.append(row)
                self.report["peakObservedPhysicalFootprintBytes"] = max(
                    self.report.get("peakObservedPhysicalFootprintBytes", 0), values[7])
                self.report["peakObservedResidentBytes"] = max(
                    self.report.get("peakObservedResidentBytes", 0), values[6])
            self.stop.wait(0.1)

    def close(self):
        if self.process.poll() is None:
            lib = ctypes.CDLL("/usr/lib/libproc.dylib")
            extended = ctypes.create_string_buffer(296)
            if lib.proc_pid_rusage(self.process.pid, 4, ctypes.byref(extended)) == 0:
                self.report["kernelLifetimeMaxPhysicalFootprintBytes"] = max(
                    self.report["kernelLifetimeMaxPhysicalFootprintBytes"], struct.unpack_from("Q", extended.raw, 240)[0])
            self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
                self.report["serverForcedKill"] = True
        self.stop.set()
        self.sampler.join(timeout=2)
        self.log.close()
        self.report["serverReturnCode"] = self.process.returncode
        self.report["serverProcessEnded"] = self.process.poll() is not None
        save(self.directory / "memory-samples.json", self.samples)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--fixture", type=Path, action="append")
    parser.add_argument("--context", type=int, choices=[8192, 16384], default=8192)
    parser.add_argument("--build-only", action="store_true")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    if (output / "manifest.json").exists():
        parser.error("Use a new output directory; previous evidence is preserved")
    runtime = json.loads((QA / "runtime-identity.json").read_text())
    model = json.loads((QA / "model-manifest.json").read_text())
    assert model["integrityVerified"] is True
    binary, model_path = Path(runtime["binary"]), Path(model["localFile"])
    assert sha(binary) == runtime["binarySHA256"]
    manifest = {"schemaVersion": 1, "status": "building", "runtime": runtime, "model": model,
        "explicitChatTemplateFix": json.loads((QA / "chat-template-fix.json").read_text()),
        "runnerSHA256": sha(Path(__file__)), "sourceSnapshot": {}, "runs": [],
        "contextTokens": args.context, "backend": "cpu", "nativeInferencePerformed": False,
        "physicalDevice": False, "performanceComparison": False, "semanticAcceptance": False,
        "sampling": SAMPLING, "thinkingMode": "official /no_think + enable_thinking=false",
        "differentFromGemma": "SmolLM3 model chat template and no private thinking budget; llama.cpp schema grammar. Same product prompts/provenance contracts."}
    build = output / "contract-build"
    build.mkdir()
    for name in FILES:
        original = ROOT / "ios/Langform/Langform" / name
        snapshot = build / name
        snapshot.write_bytes(original.read_bytes())
        manifest["sourceSnapshot"][name] = {"originalPath": str(original), "compiledPath": str(snapshot),
            "sha256": sha(original), "compiledSHA256": sha(snapshot)}
    helper = ROOT / "scripts/diagnostics/SmolSummaryContract.swift"
    snapshot = build / helper.name
    snapshot.write_bytes(helper.read_bytes())
    manifest["helperSHA256"] = sha(helper)
    command = ["xcrun", "swiftc", "-O", "-swift-version", "5", "-parse-as-library",
               "-o", str(build / "SmolSummaryContract")] + [str(p) for p in sorted(build.glob("*.swift"))]
    manifest["contractBuildCommand"] = command
    save(output / "manifest.json", manifest)
    with (output / "contract-build.log").open("w") as log:
        subprocess.run(command, check=True, stdout=log, stderr=subprocess.STDOUT)
    manifest["contractBinarySHA256"] = sha(build / "SmolSummaryContract")
    manifest["status"] = "built"
    save(output / "manifest.json", manifest)
    if args.build_only:
        return 0
    assert model_path.stat().st_size == model["bytes"] and sha(model_path) == model["sha256"]

    def contract(source, operation, **fields):
        request = {"operation": operation, "sourcePath": str(source), **fields}
        response = subprocess.run([str(build / "SmolSummaryContract")], input=json.dumps(request),
                                  text=True, capture_output=True)
        value = json.loads(response.stdout)
        if response.returncode:
            raise RuntimeError("Product contract rejected input: " + str(value))
        return value

    fixtures = args.fixture or [ROOT / "docs/qa/gemma-repair-2026-10-19/device81-summary-source.txt",
                                ROOT / "tests/fixtures/summary/europapark.en.txt",
                                ROOT / "tests/fixtures/summary/heidepark.de.txt"]
    overall = 0
    for source in fixtures:
        source = source.resolve()
        directory = output / source.stem
        directory.mkdir()
        report = {"status": "preparing", "complete": False, "semanticAcceptance": False,
            "sourcePath": str(source), "sourceSHA256": sha(source), "contextTokens": args.context,
            "physicalDevice": False, "providerRoute": "QA llama.cpp + actual product Swift contracts",
            "stages": [], "writerAttempts": [], "appRepairs": [], "sampling": SAMPLING}
        server = None
        started = time.monotonic()
        try:
            prepared = contract(source, "prepare")
            assert prepared["sourceReconstructedExactly"]
            report["sourceContract"] = {k: v for k, v in prepared.items()
                                       if k not in ["preparedSource", "prompt", "schema", "schemaJSON", "instructions", "baseInstructions"]}
            (directory / "source.txt").write_bytes(source.read_bytes())
            (directory / "prepared-source.txt").write_text(prepared["preparedSource"])
            save(directory / "result.json", report)
            server = Server(binary, model_path, args.context, directory, report)

            def generate(name, specification, token_limit):
                schema_json = specification["schemaJSON"]
                schema = json.loads(schema_json)
                # Raw product schema strings preserve every nested property order.
                assert schema == specification["schema"]
                orders = property_orders(schema)
                expected = {"$": ["verdict", "positive", "critical", "context"]} if name == "selection" else {
                    "$": ["tldr", "points", "takeaway"],
                    "$.properties.tldr": ["text", "evidenceIDs"],
                    "$.properties.points.items": ["role", "text", "evidenceIDs"],
                    "$.properties.takeaway": ["text", "evidenceIDs"]}
                assert orders == expected, (name, orders)
                messages = [{"role": "system", "content": specification["instructions"]},
                            {"role": "user", "content": specification["prompt"]}]
                template = server.request("/apply-template", {"messages": messages,
                    "chat_template_kwargs": {"enable_thinking": False}, "add_generation_prompt": True})
                rendered = template["prompt"]
                assistant_tail = rendered.rsplit("<|im_start|>assistant\n", 1)[-1]
                tokens = server.request("/tokenize", {"content": rendered,
                    "add_special": True, "parse_special": True})["tokens"]
                stage = {"name": name, "schemaPropertyOrders": orders,
                    "productSchemaSHA256": hashlib.sha256(schema_json.encode()).hexdigest(),
                    "promptTokens": len(tokens), "outputTokenLimit": token_limit,
                    "contextTokens": args.context, "fullPromptSHA256": hashlib.sha256(rendered.encode()).hexdigest(),
                    "promptFit": len(tokens) + token_limit <= args.context,
                    "fullUserMessageRetained": specification["prompt"] in rendered,
                    "fullSystemInstructionsRetained": specification["baseInstructions"] in rendered,
                    "systemUserBoundaryClosed": rendered.split("<|im_start|>user", 1)[0].rstrip().endswith("<|im_end|>"),
                    "renderedNoThinkingMode": "Reasoning Mode: /no_think" in rendered,
                    "noThinkingAssistantPrefixClosed": "".join(assistant_tail.split()) == "<think></think>",
                    "completePreparedSourceProvidedToSelection": name == "selection"}
                report["stages"].append(stage)
                save(directory / (name + "-messages.json"), messages)
                (directory / (name + "-rendered-prompt.txt")).write_text(rendered)
                save(directory / (name + "-prompt-token-ids.json"), tokens)
                (directory / (name + "-schema-product-original.json")).write_text(schema_json)
                save(directory / (name + "-schema.json"), schema)
                save(directory / "result.json", report)
                if not all(stage[key] for key in ["fullUserMessageRetained", "fullSystemInstructionsRetained",
                                                  "systemUserBoundaryClosed", "renderedNoThinkingMode", "noThinkingAssistantPrefixClosed"]):
                    raise RuntimeError(name + ": actual rendered model template violated full-source/nonthinking contract")
                if not stage["promptFit"]:
                    raise ContextTooLarge(name + ": full rendered input" + str(len(tokens))
                                          + " + output" + str(token_limit) + " exceeds" + str(args.context))
                erased = server.request("/slots/0?action=erase", {})
                stage["slotEraseBeforeGeneration"] = erased
                request = {"prompt": tokens, "n_predict": token_limit, "json_schema": schema,
                    "cache_prompt": False, "stream": False, "return_tokens": True,
                    "id_slot": 0, "ignore_eos": False, **SAMPLING}
                save(directory / (name + "-request.json"), request)
                stage["nativeInferenceRequested"] = True
                report["nativeInferenceRequested"] = True
                manifest["nativeInferenceRequested"] = True
                save(directory / "result.json", report)
                save(output / "manifest.json", manifest)
                call_start = time.monotonic()
                response = server.request("/completion", request)
                stage["wallSeconds"] = time.monotonic() - call_start
                stage["stopType"] = response.get("stop_type")
                stage["truncated"] = response.get("truncated")
                stage["tokensEvaluated"] = response.get("tokens_evaluated")
                stage["tokensPredicted"] = response.get("tokens_predicted", response.get("timings", {}).get("predicted_n"))
                stage["nativeInferencePerformed"] = bool(stage["tokensPredicted"] or response.get("content"))
                if stage["nativeInferencePerformed"]:
                    report["nativeInferencePerformed"] = True
                    manifest["nativeInferencePerformed"] = True
                save(output / "manifest.json", manifest)
                stage["timings"] = response.get("timings")
                save(directory / (name + "-response.json"), response)
                text = response["content"]
                (directory / (name + "-output.txt")).write_text(text)
                if response.get("truncated") is not False or response.get("stop_type") != "eos":
                    raise RuntimeError(name + ": incomplete native generation")
                if response.get("tokens_evaluated") != len(tokens):
                    raise RuntimeError(name + ": actual native prompt-token count mismatch")
                json.loads(text)
                save(directory / "result.json", report)
                return text

            selection = generate("selection", prepared, prepared["selectionTokenLimit"])
            report["selection"] = selection
            writer = contract(source, "writer", selection=selection)
            report["includedEvidenceIDs"] = writer["includedEvidenceIDs"]
            output_text = generate("writer-1", writer, writer["writerTokenLimit"])
            validation = contract(source, "validate", selection=selection, output=output_text)
            report["writerAttempts"].append({"index": 1, "raw": output_text, "issues": validation["issues"]})
            if not validation["validatorPassed"]:
                repair = contract(source, "repair", selection=selection, output=output_text)
                if repair["preparedOutput"] != output_text:
                    report["appRepairs"].append({"raw": repair["preparedOutput"], "removedPointIndices": repair["removedPointIndices"]})
                    output_text = repair["preparedOutput"]
                if repair["needsGeneration"]:
                    output_text = generate("writer-2", repair, repair["correctionTokenLimit"])
                    validation = contract(source, "validate", selection=selection, output=output_text)
                    report["writerAttempts"].append({"index": 2, "raw": output_text, "issues": validation["issues"]})
                    if not validation["validatorPassed"]:
                        repair = contract(source, "repair", selection=selection, output=output_text)
                        if repair["preparedOutput"] != output_text:
                            report["appRepairs"].append({"raw": repair["preparedOutput"], "removedPointIndices": repair["removedPointIndices"]})
                            output_text = repair["preparedOutput"]
                validation = contract(source, "validate", selection=selection, output=output_text)
            report["finalValidation"] = {k: validation.get(k) for k in ["issues", "validatorPassed", "document", "sourceYear"]}
            report["acceptedDocument"] = validation.get("document") if validation["validatorPassed"] else None
            report["complete"] = validation["validatorPassed"]
            report["status"] = "completed" if report["complete"] else "validation_failed"
            (directory / "final-output.txt").write_text(output_text)
        except ContextTooLarge as error:
            report["status"] = "context_too_large"
            report["error"] = str(error)
        except Exception as error:
            report["status"] = "failed"
            report["error"] = repr(error)
        finally:
            if server:
                server.close()
            report["elapsedSeconds"] = time.monotonic() - started
            save(directory / "result.json", report)
            manifest["runs"].append({"source": str(source), "status": report["status"], "result": str(directory / "result.json")})
            save(output / "manifest.json", manifest)
            print(json.dumps({"source": source.name, "status": report["status"], "result": str(directory / "result.json"),
                              "elapsedSeconds": report["elapsedSeconds"], "peakFootprint": report.get("peakObservedPhysicalFootprintBytes")}), flush=True)
            if not report["complete"]:
                overall = 2
    manifest["status"] = "completed" if not overall else "failed"
    manifest["productSourcesUnchanged"] = all(sha(Path(v["originalPath"])) == v["sha256"] for v in manifest["sourceSnapshot"].values())
    save(output / "manifest.json", manifest)
    return overall


if __name__ == "__main__":
    raise SystemExit(main())
