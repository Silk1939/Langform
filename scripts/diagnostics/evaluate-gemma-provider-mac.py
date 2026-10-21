#!/usr/bin/env python3
"""Compile and run the actual current GemmaSummary provider on macOS.

The compiled ModelStore snapshot's storage path is redirected to a hardlink
and receipt inside this evaluation directory. An explicit --model-contract
may also replace only the snapshot's model identity and integrity constants.
No product file, prompt, native setting, validation or parser is changed.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
PRODUCT = ROOT / "ios/Langform/Langform"
FILES = ["GemmaRuntime.swift", "GemmaRuntimeCache.swift", "GemmaModelStore.swift", "GemmaSummary.swift",
         "GemmaSummaryPolicy.swift", "GemmaEvidence.swift",
         "GemmaSummaryDocument.swift", "GemmaClaimValidation.swift", "GemmaSummaryRepair.swift", "OnDeviceSummary.swift"]


def sha(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for data in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(data)
    return digest.hexdigest()


def write_json(path, value):
    temporary = path.with_suffix(path.suffix + ".pending")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")
    temporary.replace(path)


def memory_snapshot():
    """Conservative macOS reclaimable estimate; total RAM alone is not enough."""
    physical = int(subprocess.check_output(["sysctl", "-n", "hw.memsize"], text=True).strip())
    text = subprocess.check_output(["vm_stat"], text=True)
    page_size = int(re.search(r"page size of ([0-9]+) bytes", text)[1])
    pages = {name: int(value) for name, value in re.findall(r"^([^:\n]+):\s+([0-9]+)\.", text, re.M)}
    available = sum(pages.get(name, 0) for name in ["Pages free", "Pages inactive", "Pages speculative"]) * page_size
    pressure = subprocess.run(["sysctl", "-n", "kern.memorystatus_vm_pressure_level"],
                              text=True, capture_output=True)
    pressure_level = int(pressure.stdout.strip()) if pressure.returncode == 0 else None
    return {"physicalMemoryBytes": physical, "estimatedAvailableBytes": available,
            "estimate": "free + inactive + speculative VM pages; excludes compressed and active pages",
            "pressureLevel": pressure_level, "vmStat": text}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--package", type=Path)
    parser.add_argument("--fixture", action="append", type=Path)
    parser.add_argument("--model-contract", type=Path,
                        help="QA-only JSON model identity/size/SHA override in the compiled ModelStore snapshot; product files stay unchanged.")
    parser.add_argument("--numeric-policy-contract", type=Path,
                        help="QA-only writer/correction token and thinking limits; no prompt, selection or product-file edits.")
    parser.add_argument("--build-only", action="store_true")
    parser.add_argument("--jobs", type=int, choices=[1, 2], default=1,
                        help="At most two independent CPU processes; memory preflight may retain one.")
    parser.add_argument("--correction-from", type=Path,
                        help="Run only the actual correction component using one prior case report; requires exactly one --fixture.")
    args = parser.parse_args()
    numeric_contract = None
    if args.numeric_policy_contract:
        numeric_contract = json.loads(args.numeric_policy_contract.read_text())
        numeric_keys = {"writerTokenLimit", "writerThinkingTokens", "correctionTokenLimit", "correctionThinkingTokens"}
        if set(numeric_contract) != numeric_keys or any(type(v) is not int for v in numeric_contract.values()):
            parser.error("--numeric-policy-contract requires exactly four integer writer/correction limits.")
        for prefix in ["writer", "correction"]:
            limit = numeric_contract[prefix + "TokenLimit"]
            thought = numeric_contract[prefix + "ThinkingTokens"]
            if not 1 <= limit <= 4096 or not 0 <= thought < limit:
                parser.error("QA token limits must be1...4096 and thinking must be below its output limit.")
    model_contract = None
    if args.model_contract:
        model_contract = json.loads(args.model_contract.read_text())
        required = {"modelName", "revision", "expectedSHA256", "expectedBytes", "providerIdentityPrefix", "downloadURL"}
        if set(model_contract) != required:
            parser.error("--model-contract must contain exactly: " + ", ".join(sorted(required)))
        if (not re.fullmatch(r"[0-9a-f]{64}", model_contract["expectedSHA256"])
                or not re.fullmatch(r"[0-9a-f]{40}", model_contract["revision"])
                or type(model_contract["expectedBytes"]) is not int or model_contract["expectedBytes"] <= 0
                or not all(isinstance(model_contract[k], str) and model_contract[k]
                           for k in required - {"expectedBytes"})
                or not model_contract["downloadURL"].startswith("https://huggingface.co/")):
            parser.error("Invalid QA model contract.")
    if args.correction_from and len(args.fixture or []) != 1:
        parser.error("--correction-from requires exactly one explicit --fixture.")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    if (output / "manifest.json").exists():
        parser.error("Use a new output directory; existing evidence is never overwritten.")
    package = args.package
    if package is None:
        choices = sorted((Path.home() / "Library/Developer/Xcode/DerivedData").glob(
            "*/SourcePackages/checkouts/LiteRT-LM/Package.swift"))
        if not choices:
            parser.error("Pass the locally cached official LiteRT-LM 0.18.0 package with --package.")
        package = choices[0].parent
    package = package.resolve()
    packages = package.parents[1]
    native = packages / "artifacts/litert-lm/CLiteRTLM_mac/CLiteRTLM_mac.xcframework/macos-arm64_x86_64"
    if not (native / "libCLiteRTLM_mac.dylib").exists():
        parser.error("The official local macOS 0.18.0 binary target is missing.")
    manifest = {"schemaVersion": 1, "platform": "macOS", "physicalDevice": False,
                "providerRoute": "nativeCorrectionComponent" if args.correction_from else "GemmaSummary.reply", "package": str(package),
                "nativeLibrary": str(native / "libCLiteRTLM_mac.dylib"),
                "nativeLibrarySHA256": sha(native / "libCLiteRTLM_mac.dylib"),
                "sourceSnapshot": {}, "status": "building", "runs": [],
                "requestedJobs": args.jobs, "semanticAcceptance": False,
                "runnerSHA256": sha(Path(__file__))}
    if model_contract:
        manifest["qaModelContract"] = {"path": str(args.model_contract.resolve()),
                                      "sha256": sha(args.model_contract), "contract": model_contract,
                                      "productModelChanged": False}
    if numeric_contract:
        manifest["qaNumericPolicyContract"] = {"path": str(args.numeric_policy_contract.resolve()),
            "sha256": sha(args.numeric_policy_contract), "contract": numeric_contract,
            "productPolicyChanged": False, "selectionAndPromptTextChanged": False}
    build = output / "build"
    sources = build / "sources"
    sources.mkdir(parents=True)
    for name in FILES:
        original = PRODUCT / name
        contents = original.read_text()
        transformation = None
        if name == "GemmaModelStore.swift":
            pattern = r'nonisolated static let localModelURL = FileManager\.default\.urls\(for: \.applicationSupportDirectory, in: \.userDomainMask\)\[0\]\n(?:\s*\.appendingPathComponent\([^\n]+\)\n){2}\s*\.appendingPathComponent\([^\n]+\)'
            replacement = 'nonisolated static let localModelURL = URL(fileURLWithPath: ProcessInfo.processInfo.environment["LANGFORM_GEMMA_EVAL_MODEL"]!)'
            contents, count = re.subn(pattern, replacement, contents)
            if count != 1:
                raise RuntimeError("ModelStore path declaration changed; inspect rather than patching broadly.")
            transformation = "Only localModelURL redirected to LANGFORM_GEMMA_EVAL_MODEL; all validation and receipt code unchanged."
            if model_contract:
                replacements = {
                    "modelName": json.dumps(model_contract["modelName"]),
                    "revision": json.dumps(model_contract["revision"]),
                    "expectedSHA256": json.dumps(model_contract["expectedSHA256"]),
                    "expectedBytes": str(model_contract["expectedBytes"]),
                    "providerIdentity": json.dumps(model_contract["providerIdentityPrefix"]) + ' + revision + ":sha256:" + expectedSHA256',
                    "downloadURL": 'URL(string: ' + json.dumps(model_contract["downloadURL"]) + ')!',
                }
                for key, value in replacements.items():
                    declaration = r"(nonisolated static let " + key + r"(?:: Int64)? = )[^\n]+"
                    contents, count = re.subn(declaration, lambda match: match[1] + value, contents)
                    if count != 1:
                        raise RuntimeError("ModelStore QA identity declaration changed: " + key)
                transformation = ("QA-only localModelURL and explicit model identity/size/SHA/downloadURL contract override; "
                                  "all native runtime, policy, validation, receipt and provider code unchanged.")
        if name == "GemmaSummaryPolicy.swift" and numeric_contract:
            for key, value in numeric_contract.items():
                contents, count = re.subn(r"(static let " + key + r" = )[0-9]+",
                                         lambda match: match[1] + str(value), contents)
                if count != 1:
                    raise RuntimeError("QA numeric policy declaration changed: " + key)
            for prefix in ["writer", "correction"]:
                value = (prefix + "thought" + str(numeric_contract[prefix + "ThinkingTokens"])
                         + "-max" + str(numeric_contract[prefix + "TokenLimit"]))
                contents, count = re.subn(prefix + r"thought[0-9]+-max[0-9]+", value, contents)
                if count != 1:
                    raise RuntimeError("QA runtime identity declaration changed: " + prefix)
            contents, count = re.subn(r'(static let runtimeIdentity = "[^"\n]+)(")',
                                     r'\1-qa-numeric-policy-override\2', contents)
            if count != 1:
                raise RuntimeError("QA runtime identity declaration changed.")
            transformation = ("QA-only four explicitly listed writer/correction numeric limits and matching runtimeIdentity; "
                              "selection budgets, all prompt text, schemas and validation unchanged.")
        destination = sources / name
        destination.write_text(contents)
        manifest["sourceSnapshot"][name] = {"originalPath": str(original), "originalSHA256": sha(original),
            "compiledPath": str(destination), "compiledSHA256": sha(destination), "transformation": transformation}
    harness = ROOT / "scripts/diagnostics/GemmaProviderEval.swift"
    (sources / harness.name).write_bytes(harness.read_bytes())
    manifest["harnessSHA256"] = sha(harness)
    wrapper_sources = sorted(p for p in (package / "swift").glob("*.swift") if not p.name.endswith("Tests.swift"))
    common = ["xcrun", "swiftc", "-O", "-swift-version", "5", "-I", str(native / "Headers"),
              "-L", str(native), "-lCLiteRTLM_mac", "-Xlinker", "-rpath", "-Xlinker", str(native)]
    commands = [common + ["-emit-library", "-emit-module", "-module-name", "LiteRTLM",
                          "-emit-module-path", str(build / "LiteRTLM.swiftmodule"),
                          "-o", str(build / "libLiteRTLM.dylib")] + list(map(str, wrapper_sources)),
                common + ["-parse-as-library", "-I", str(build), "-L", str(build), "-lLiteRTLM",
                          "-Xlinker", "-rpath", "-Xlinker", str(build),
                          "-o", str(build / "GemmaProviderEval")] + list(map(str, sorted(sources.glob("*.swift"))))]
    manifest["buildCommands"] = commands
    write_json(output / "manifest.json", manifest)
    with (output / "build.log").open("w") as log:
        for command in commands:
            print("Building " + ("official LiteRTLM wrapper" if "-emit-module" in command else "current product provider"), flush=True)
            subprocess.run(command, check=True, stdout=log, stderr=subprocess.STDOUT)
    manifest["executableSHA256"] = sha(build / "GemmaProviderEval")
    manifest["status"] = "built"
    write_json(output / "manifest.json", manifest)
    if args.build_only:
        return 0
    if args.model is None:
        parser.error("--model is required unless --build-only is used.")
    model = args.model.resolve()
    store = (sources / "GemmaModelStore.swift").read_text()
    expected_hash = re.search(r'expectedSHA256 = "([0-9a-f]{64})"', store)[1]
    expected_bytes = int(re.search(r'expectedBytes: Int64 = ([0-9_]+)', store)[1].replace("_", ""))
    if model.stat().st_size != expected_bytes or sha(model) != expected_hash:
        raise RuntimeError("Pinned model size/SHA256 validation failed.")
    manifest["model"] = {"originalPath": str(model), "bytes": expected_bytes,
                         "sha256": expected_hash, "fixture": "one hardlink and isolated receipt/runtime cache per case"}
    fixtures = args.fixture or [ROOT / "tests/fixtures/summary/heidepark.de.txt",
                                ROOT / "tests/fixtures/summary/europapark.en.txt"]
    if len({source.name for source in fixtures}) != len(fixtures):
        parser.error("Fixture basenames must be distinct to preserve isolated output paths.")
    memory = memory_snapshot()
    jobs = args.jobs
    manifest["concurrencyDecisionBasis"] = {
        "minimumEstimatedAvailableBytes": 7_000_000_000,
        "observedPriorMaximumProcessFootprintBytes": 2_309_052_872,
        "maximumTwoProcessFootprintEstimateBytes": 2 * 2_309_052_872,
        "minimumReserveBytes": 2_000_000_000,
        "reason": "Root-approved threshold based on two V13 process peaks plus at least 2 GB reserve; normal pressure required."
    }
    if jobs == 2 and (memory["pressureLevel"] != 1 or memory["estimatedAvailableBytes"] < 7_000_000_000):
        jobs = 1
        manifest["concurrencyFallback"] = "Two CPU processes require normal memory pressure and at least 7 GB estimated available."
    manifest["memoryBeforeRuns"] = memory
    manifest["effectiveJobs"] = jobs
    manifest["executionMode"] = "parallel independent CPU processes" if jobs == 2 else "serial independent CPU processes"
    manifest["performanceComparison"] = False
    write_json(output / "manifest.json", manifest)
    print(f"CPU evaluation jobs: {jobs}; estimated available bytes: {memory['estimatedAvailableBytes']}; pressure: {memory['pressureLevel']}", flush=True)

    def run_fixture(source):
        source = source.resolve()
        name = source.name.removesuffix(".txt")
        destination = output / name
        destination.mkdir()
        model_fixture = destination / "model" / model.name
        model_fixture.parent.mkdir()
        os.link(model, model_fixture)
        environment = dict(os.environ, LANGFORM_GEMMA_EVAL_MODEL=str(model_fixture),
                           LANGFORM_GEMMA_EVAL_EXECUTION_MODE=manifest["executionMode"],
                           LANGFORM_GEMMA_EVAL_JOBS=str(jobs),
                           LANGFORM_GEMMA_EVAL_SOURCE_MANIFEST=str(output / "manifest.json"))
        # Avoid opt-in traces writing to the normal user's GemmaProbe cache.
        environment.pop("LANGFORM_GEMMA_PROBE", None)
        if args.correction_from:
            environment["LANGFORM_GEMMA_EVAL_CORRECTION_FROM"] = str(args.correction_from.resolve())
        else:
            environment.pop("LANGFORM_GEMMA_EVAL_CORRECTION_FROM", None)
        start = time.monotonic()
        print("Starting actual provider: " + name, flush=True)
        with (destination / "runtime.log").open("w") as log:
            result = subprocess.run([str(build / "GemmaProviderEval"), str(source), str(destination)],
                                    env=environment, stdout=log, stderr=subprocess.STDOUT)
        record = {"fixture": str(source), "fixtureSHA256": sha(source), "returnCode": result.returncode,
                  "processWallSeconds": time.monotonic() - start, "result": str(destination / "result.json"),
                  "modelFixturePath": str(model_fixture), "modelFixtureInode": model_fixture.stat().st_ino,
                  "isolatedWritableModelDirectory": str(model_fixture.parent),
                  "executionMode": manifest["executionMode"], "performanceComparison": False}
        return record

    exit_status = 0
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        for future in as_completed([pool.submit(run_fixture, source) for source in fixtures]):
            record = future.result()
            manifest["runs"].append(record)
            write_json(output / "manifest.json", manifest)
            print(json.dumps(record), flush=True)
            if record["returnCode"]:
                exit_status = 2
    manifest["status"] = "completed" if not exit_status else "failed"
    write_json(output / "manifest.json", manifest)
    return exit_status


if __name__ == "__main__":
    sys.exit(main())
