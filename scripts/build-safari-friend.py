#!/usr/bin/env python3
"""Build a portable Safari beta in a new folder without Apple account signing."""

import argparse
import hashlib
import json
import pathlib
import plistlib
import re
import shutil
import subprocess
import sys


def run(args, log):
    result = subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    with log.open("a") as handle:
        handle.write("\n$ " + " ".join(map(str, args)) + "\n" + result.stdout)
    if result.returncode:
        raise RuntimeError(f"Schritt fehlgeschlagen; Details: {log}\n{result.stdout[-4000:]}")
    return result.stdout.strip()


def files(root):
    return sorted(p for p in root.rglob("*") if p.is_file() and p.name != ".DS_Store")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=pathlib.Path, required=True, help="Neuer, noch nicht vorhandener Ausgabeordner")
    options = parser.parse_args()
    source = options.source_root.resolve()
    output = options.output.expanduser().resolve()
    if sys.platform != "darwin":
        parser.error("Der Build benötigt einen Mac mit vollständigem Xcode.")
    if output.exists():
        parser.error("Ausgabeordner existiert bereits; bitte einen neuen Ordner wählen.")
    if not (source / "extension/manifest.json").is_file() or not (source / "native/SafariWebExtensionHandler.swift").is_file():
        parser.error("Erweiterungsquellen oder nativer Safari-Handler fehlen.")
    subprocess.run(["xcrun", "--find", "safari-web-extension-converter"], check=True, stdout=subprocess.DEVNULL)
    output.mkdir(parents=True)
    log = output / "build.log"
    snapshot = output / "source"
    snapshot.mkdir()
    shutil.copytree(source / "extension", snapshot / "extension", ignore=shutil.ignore_patterns(".DS_Store"))
    (snapshot / "native").mkdir()
    shutil.copy2(source / "native/SafariWebExtensionHandler.swift", snapshot / "native/SafariWebExtensionHandler.swift")
    hashes_before = {str(p.relative_to(snapshot)): digest(p) for p in files(snapshot)}
    generated = output / "project"
    run(["xcrun", "safari-web-extension-converter", str(snapshot / "extension"),
         "--project-location", str(generated), "--app-name", "Langform Safari",
         "--bundle-identifier", "de.ipekkaya.shorts-ausblenden", "--swift", "--macos-only",
         "--copy-resources", "--no-open", "--no-prompt"], log)
    projects = list(generated.rglob("*.xcodeproj"))
    if len(projects) != 1:
        raise RuntimeError("Genau ein generiertes macOS-Projekt erwartet.")
    project = projects[0]
    settings_file = project / "project.pbxproj"
    settings = settings_file.read_text()
    # Remove converter defaults before Xcode ever opens this isolated project.
    settings = re.sub(r"(CODE_SIGN_STYLE|ProvisioningStyle)\s*=\s*Automatic;", r"\1 = Manual;", settings)
    settings = re.sub(r'(?m)^\s*"?(?:CODE_SIGN_IDENTITY|DEVELOPMENT_TEAM|PROVISIONING_PROFILE(?:_SPECIFIER)?)(?:\[[^\]]+\])?"?\s*=\s*[^;\n]*;', "", settings)
    settings = re.sub(r"MACOSX_DEPLOYMENT_TARGET = [^;]+;", "MACOSX_DEPLOYMENT_TARGET = 12.0;", settings)
    settings = re.sub(r"PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);",
                      lambda match: "PRODUCT_BUNDLE_IDENTIFIER = de.ipekkaya.shorts-ausblenden" +
                      (".Extension" if ".Extension" in match[1] else "") + ";", settings)
    settings_file.write_text(settings)
    handlers = list(generated.rglob("SafariWebExtensionHandler.swift"))
    if len(handlers) != 1:
        raise RuntimeError("Genau ein macOS-Extension-Handler erwartet.")
    shutil.copy2(snapshot / "native/SafariWebExtensionHandler.swift", handlers[0])
    manifest = json.loads((snapshot / "extension/manifest.json").read_text())
    project_info = json.loads(run(["xcodebuild", "-list", "-json", "-project", str(project)], log))
    schemes = project_info["project"]["schemes"]
    if len(schemes) != 1:
        raise RuntimeError("Genau ein macOS-App-Schema erwartet.")
    run(["xcodebuild", "-project", str(project), "-scheme", schemes[0],
         "-configuration", "Release", "-destination", "generic/platform=macOS",
         "-derivedDataPath", str(output / "DerivedData"), "CODE_SIGNING_ALLOWED=NO",
         "CODE_SIGNING_REQUIRED=NO", "CODE_SIGN_STYLE=Manual", "CODE_SIGN_IDENTITY=",
         "DEVELOPMENT_TEAM=", "PROVISIONING_PROFILE_SPECIFIER=", "ONLY_ACTIVE_ARCH=NO",
         "ARCHS=arm64 x86_64", "MACOSX_DEPLOYMENT_TARGET=12.0",
         "MARKETING_VERSION=" + manifest["version"], "CURRENT_PROJECT_VERSION=1"], log)
    built = output / "DerivedData/Build/Products/Release/Langform Safari.app"
    app = output / "Langform Safari.app"
    shutil.copytree(built, app)
    plugins = list((app / "Contents/PlugIns").glob("*.appex"))
    if len(plugins) != 1:
        raise RuntimeError("Genau eine eingebettete Safari-Erweiterung erwartet.")
    plugin = plugins[0]
    binaries = {}
    for bundle in (plugin, app):
        info = plistlib.loads((bundle / "Contents/Info.plist").read_bytes())
        binary = bundle / "Contents/MacOS" / info["CFBundleExecutable"]
        architectures = run(["lipo", "-archs", str(binary)], log).split()
        if set(architectures) != {"arm64", "x86_64"}:
            raise RuntimeError("Universal-Binary für App und Extension erforderlich.")
        if info["LSMinimumSystemVersion"] != "12.0":
            raise RuntimeError("Mindestversion des erzeugten Bundles ist unerwartet.")
        binaries[bundle.name] = {"architectures": architectures, "minimum_macos": info["LSMinimumSystemVersion"]}
        # Apple Silicon requires a local code signature. '-' is ad-hoc and does
        # not access a keychain identity, Apple account, certificate or profile.
        # These are the converter template's sandbox permissions. Preserve them
        # when signing locally, because Xcode signing is disabled for this build.
        entitlements = {"com.apple.security.app-sandbox": True,
                        "com.apple.security.files.user-selected.read-only": True}
        if bundle == app:
            entitlements["com.apple.security.network.client"] = True
        entitlement_file = output / (bundle.stem + "-entitlements.plist")
        entitlement_file.write_bytes(plistlib.dumps(entitlements))
        command = ["codesign", "--force", "--sign", "-", "--timestamp=none",
                   "--entitlements", str(entitlement_file)]
        run(command + [str(bundle)], log)
    run(["codesign", "--verify", "--deep", "--strict", "--verbose=2", str(app)], log)
    resources = plugin / "Contents/Resources"
    resource_hashes = {}
    for original in files(snapshot / "extension"):
        relative = original.relative_to(snapshot / "extension")
        packaged = resources / relative
        if not packaged.is_file() or digest(original) != digest(packaged):
            raise RuntimeError(f"Erweiterungsressource fehlt oder wurde geändert: {relative}")
        resource_hashes[str(relative)] = digest(packaged)
    packaged_handler = handlers[0]
    if digest(packaged_handler) != digest(snapshot / "native/SafariWebExtensionHandler.swift"):
        raise RuntimeError("Nativer Handler ist nicht bytegleich zur Quelle.")
    hashes_after = {str(p.relative_to(snapshot)): digest(p) for p in files(snapshot)}
    if hashes_before != hashes_after:
        raise RuntimeError("Build hat die Quellkopie verändert.")
    evidence = {"version": manifest["version"], "app": str(app), "signing": "ad-hoc; no Apple identity; not notarized",
                "binaries": binaries, "extension_resources": resource_hashes, "source_hashes": hashes_after,
                "build_and_signature": "passed", "friend_installation": "not tested",
                "safari_activation_and_youtube": "not tested", "on_device_summary": "not tested"}
    (output / "verification.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n")
    print(f"Universal-App erstellt und geprüft: {app}")
    print("Safari benötigt für diese Beta 'Nicht signierte Erweiterungen erlauben'.")


if __name__ == "__main__":
    main()
