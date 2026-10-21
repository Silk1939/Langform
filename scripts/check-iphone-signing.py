#!/usr/bin/env python3
"""Resolve existing local iPhone signing material without provisioning changes.

Print the selected profile UUID to stdout; diagnostics go to stderr. The caller
must supply the deliberately pinned certificate fingerprint. No account login,
certificate creation/revocation, profile download, or Xcode operation occurs.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile


class SigningError(Exception):
    pass


# Official LiteRT-LM v0.18.0, ios-arm64 slice. The source archive is pinned by
# SwiftPM SHA-256 d765b99592d4ec3d0c9e2bd69469454af06c834861340672da1891c0c121c347.
# Xcode embeds the executable unchanged. codesign --remove-signature normalizes
# a previously signed copy to the second hash (load-command reservation differs).
LITERT_DEVICE_BINARY_SHA256 = "02d99220cba485d5a781dcb64d92025211c22aefe55fab6fab4f973fad6e51be"
LITERT_RESIGNED_UNSIGNED_SHA256 = "471e440db92155eea0d972317265bdd0566329aeedc2b18e899d9d2c9f4cc97d"


def file_sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def check_litert_framework(framework):
    """Approve only the exact official iPhone runtime, including repeat signing."""
    info = plistlib.loads((framework / "Info.plist").read_bytes())
    expected = {
        "CFBundleIdentifier": "com.google.odml.litertlm.CLiteRTLM",
        "CFBundlePackageType": "FMWK",
        "CFBundleExecutable": "CLiteRTLM",
        "CFBundleSupportedPlatforms": ["iPhoneOS"],
    }
    if any(info.get(key) != value for key, value in expected.items()):
        raise SigningError("Das eingebettete Google-Framework hat unerwartete Bundle-Metadaten.")
    executable = framework / "CLiteRTLM"
    if not executable.is_file():
        raise SigningError("Dem eingebetteten Google-Framework fehlt die geprüfte Hauptdatei.")
    if file_sha256(executable) == LITERT_DEVICE_BINARY_SHA256:
        return executable
    # Re-signing must also work after an incremental build. Never modify the
    # actual bundle to establish provenance: strip only a temporary binary copy.
    try:
        subprocess.run(["codesign", "--verify", "--strict", str(framework)], capture_output=True, check=True)
        with tempfile.TemporaryDirectory(prefix="langform-framework-check-") as directory:
            unsigned = Path(directory) / "CLiteRTLM"
            shutil.copyfile(executable, unsigned)
            subprocess.run(["codesign", "--remove-signature", str(unsigned)], capture_output=True, check=True)
            if file_sha256(unsigned) == LITERT_RESIGNED_UNSIGNED_SHA256:
                return executable
    except subprocess.SubprocessError:
        pass
    raise SigningError("Das Google-Framework entspricht nicht der ausdrücklich freigegebenen LiteRT-LM-Version 0.18.0.")


def verify_signed_code(code, *, identity, entitlements, directory, name):
    subprocess.run(["codesign", "--verify", "--strict", str(code)], check=True)
    signed = subprocess.run(["codesign", "-d", "--entitlements", ":-", str(code)], capture_output=True, check=True)
    actual = plistlib.loads(signed.stdout) if signed.stdout.strip() else {}
    if actual != entitlements:
        raise SigningError(f"Die signierten Berechtigungen von {name} stimmen nicht mit der Prüfung überein.")
    certificate_prefix = str(Path(directory) / f"signing-cert-{name}-")
    subprocess.run(["codesign", "-d", f"--extract-certificates={certificate_prefix}", str(code)], capture_output=True, check=True)
    certificate = Path(certificate_prefix + "0").read_bytes()
    if hashlib.sha1(certificate).hexdigest().upper() != identity:
        raise SigningError(f"Das signierte Zertifikat von {name} stimmt nicht mit dem festen Zertifikat überein.")


def local_identities():
    result = subprocess.run(
        ["security", "find-identity", "-v", "-p", "codesigning"],
        capture_output=True, text=True, check=True,
    )
    # Security can include revoked certificates in its "valid identities" list.
    # Require a clean entry with no trailing CSSMERR or other error annotation.
    return {
        match.group(1).upper()
        for line in result.stdout.splitlines()
        if (match := re.fullmatch(r'\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"[^"\r\n]+"\s*', line))
    }


def utc(value):
    if not isinstance(value, datetime):
        raise ValueError("Ungültiges Profildatum")
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def profile_problem(profile, *, identity, team, bundle, device, now):
    """Return a reason to reject a profile, or None when it matches exactly."""
    entitlements = profile.get("Entitlements", {})
    if profile.get("TeamIdentifier") != [team]:
        return "anderes Team"
    if "iOS" not in profile.get("Platform", []):
        return "kein iOS-Profil"
    if entitlements.get("com.apple.developer.team-identifier") != team:
        return "abweichendes Team in den Berechtigungen"
    if entitlements.get("application-identifier") != f"{team}.{bundle}":
        return "andere App-ID"
    supported = {"application-identifier", "com.apple.developer.team-identifier", "get-task-allow", "keychain-access-groups"}
    if set(entitlements) - supported:
        return "zusätzliche Profil-Berechtigungen müssen ausdrücklich unterstützt werden"
    if entitlements.get("get-task-allow") is not True:
        return "kein passendes Entwicklungsprofil"
    if device not in profile.get("ProvisionedDevices", []):
        return "SrTan fehlt im Profil"
    try:
        if utc(profile.get("ExpirationDate")) <= now:
            return "Profil abgelaufen"
        if utc(profile.get("CreationDate")) > now:
            return "Profil noch nicht gültig"
    except ValueError:
        return "Profildatum fehlt oder ist ungültig"
    certificates = profile.get("DeveloperCertificates", [])
    if not isinstance(certificates, list) or not all(isinstance(cert, bytes) for cert in certificates):
        return "ungültige Zertifikatsliste"
    if identity not in {hashlib.sha1(cert).hexdigest().upper() for cert in certificates}:
        return "festes Zertifikat fehlt im Profil"
    if not re.fullmatch(r"[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}", str(profile.get("UUID", ""))):
        return "ungültige Profil-UUID"
    return None


def select_profile(paths, *, identity, team, bundle, device, now, expected_uuid=None):
    matches = []
    rejections = []
    for path in paths:
        try:
            result = subprocess.run(
                ["security", "cms", "-D", "-i", str(path)],
                capture_output=True, check=True,
            )
            profile = plistlib.loads(result.stdout)
            if expected_uuid and profile.get("UUID") != expected_uuid:
                continue
            problem = profile_problem(profile, identity=identity, team=team, bundle=bundle, device=device, now=now)
        except (subprocess.SubprocessError, ValueError, TypeError, AttributeError, plistlib.InvalidFileException):
            rejections.append(f"{path.name}: nicht lesbar")
            continue
        if problem:
            rejections.append(f"{path.name}: {problem}")
        else:
            matches.append((path, profile))
    if not matches:
        details = "; ".join(rejections) if rejections else "keine lokalen Provisioning-Profile vorhanden"
        raise SigningError(f"Kein gültiges lokales Profil für Langform/SrTan: {details}.")
    # A renewed profile may reuse the same pinned certificate; it is safe to use
    # the one with the longest validity. We never switch to a different identity.
    return max(matches, key=lambda item: (utc(item[1]["ExpirationDate"]), item[1]["UUID"]))


def check_project(path):
    """Fail closed if the app starts requesting unsupported entitlements."""
    result = subprocess.run(["plutil", "-convert", "json", "-o", "-", str(path)], capture_output=True, check=True)
    project = json.loads(result.stdout)
    for value in project.get("objects", {}).values():
        if value.get("isa") == "XCBuildConfiguration":
            if value.get("baseConfigurationReference"):
                raise SigningError("Externe Build-Konfiguration muss vor lokaler Signierung ausdrücklich geprüft werden.")
            settings = value.get("buildSettings", {})
            if any(key.startswith("CODE_SIGN_ENTITLEMENTS") and setting for key, setting in settings.items()):
                raise SigningError("Neue App-Entitlements müssen vor lokaler Signierung ausdrücklich unterstützt werden.")
        for attributes in value.get("attributes", {}).get("TargetAttributes", {}).values():
            capabilities = attributes.get("SystemCapabilities", {})
            if any(capability.get("enabled") for capability in capabilities.values()):
                raise SigningError("Neue App-Capabilities müssen vor lokaler Signierung ausdrücklich unterstützt werden.")


def sign_app(app, profile_path, profile, *, identity, team, bundle):
    info = plistlib.loads((app / "Info.plist").read_bytes())
    if info.get("CFBundleIdentifier") != bundle or info.get("CFBundlePackageType") != "APPL":
        raise SigningError("Das gebaute Bundle ist nicht die erwartete Langform-App.")
    executable = info.get("CFBundleExecutable", "")
    if not executable or Path(executable).name != executable or not (app / executable).is_file():
        raise SigningError("Die App enthält keine gültige Hauptdatei.")
    # Only this exact runtime is supported. Extensions, other frameworks and
    # additional Mach-O files still fail closed before any signing mutation.
    framework = app / "Frameworks/CLiteRTLM.framework"
    framework_executable = framework / "CLiteRTLM"
    has_litert = framework.is_dir()
    macho_magic = {b'\xfe\xed\xfa\xce', b'\xce\xfa\xed\xfe', b'\xfe\xed\xfa\xcf', b'\xcf\xfa\xed\xfe', b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca', b'\xca\xfe\xba\xbf', b'\xbf\xba\xfe\xca'}
    for entry in app.rglob("*"):
        if entry.is_symlink():
            raise SigningError("Verknüpfter Bundle-Inhalt muss vor lokaler Signierung ausdrücklich unterstützt werden.")
        if entry.suffix in {".app", ".appex", ".framework", ".dylib"} and not (has_litert and entry == framework):
            raise SigningError("Eingebetteter Code muss vor lokaler Signierung ausdrücklich unterstützt werden.")
        if entry.is_file() and entry not in {app / executable, framework_executable}:
            with entry.open("rb") as handle:
                if handle.read(4) in macho_magic:
                    raise SigningError(f"Zusätzliche ausführbare Datei muss ausdrücklich signiert werden: {entry.name}.")
    if has_litert:
        check_litert_framework(framework)
    embedded = app / "embedded.mobileprovision"
    shutil.copyfile(profile_path, embedded)
    copied = subprocess.run(["security", "cms", "-D", "-i", str(embedded)], capture_output=True, check=True)
    if plistlib.loads(copied.stdout) != profile:
        raise SigningError("Das Profil wurde während der Prüfung geändert; bitte erneut prüfen.")
    entitlements = {
        "application-identifier": f"{team}.{bundle}",
        "com.apple.developer.team-identifier": team,
        "get-task-allow": True,
    }
    with tempfile.TemporaryDirectory(prefix="langform-local-signing-") as directory:
        entitlement_path = Path(directory) / "Entitlements.plist"
        entitlement_path.write_bytes(plistlib.dumps(entitlements))
        if has_litert:
            # Frameworks need no provisioning profile and no app entitlements.
            # Sign explicitly inside-out with the same preflight-pinned key.
            subprocess.run(["codesign", "--force", "--sign", identity, "--timestamp=none", str(framework)], check=True)
            verify_signed_code(framework, identity=identity, entitlements={}, directory=directory, name="Google-Laufzeit")
        subprocess.run(["codesign", "--force", "--sign", identity, "--timestamp=none", "--generate-entitlement-der", "--entitlements", str(entitlement_path), str(app)], check=True)
        verify_signed_code(app, identity=identity, entitlements=entitlements, directory=directory, name="App")
    print(f"App lokal signiert und geprüft: {app}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for argument in ("identity", "team", "bundle", "device"):
        parser.add_argument(f"--{argument}", required=True)
    parser.add_argument("--project", type=Path)
    parser.add_argument("--profile", help="Beim Signieren exakt das zuvor geprüfte Profil weiterverwenden")
    parser.add_argument("--sign-app", type=Path)
    parser.add_argument("--profiles-directory", type=Path, help="Nur dieses ausdrücklich gewählte lokale Profilverzeichnis prüfen")
    args = parser.parse_args()
    args.identity = args.identity.upper()
    try:
        if not re.fullmatch(r"[A-F0-9]{40}", args.identity):
            raise SigningError("Das feste Zertifikat muss als SHA-1-Fingerabdruck angegeben sein.")
        if args.identity not in local_identities():
            raise SigningError(f"Das feste Zertifikat {args.identity} ist lokal nicht gültig verfügbar (inklusive privatem Schlüssel).")
        locations = (args.profiles_directory,) if args.profiles_directory else (
            Path.home() / "Library/Developer/Xcode/UserData/Provisioning Profiles",
            Path.home() / "Library/MobileDevice/Provisioning Profiles",
        )
        paths = sorted({path for directory in locations for path in directory.glob("*.mobileprovision")})
        profile_path, profile = select_profile(paths, identity=args.identity, team=args.team, bundle=args.bundle, device=args.device, now=datetime.now(timezone.utc), expected_uuid=args.profile)
        if args.project:
            check_project(args.project)
        if args.sign_app:
            if not args.project or not args.profile:
                raise SigningError("Lokales Signieren erfordert das geprüfte Projekt und die feste Profil-UUID.")
            sign_app(args.sign_app, profile_path, profile, identity=args.identity, team=args.team, bundle=args.bundle)
    except (SigningError, OSError, ValueError, subprocess.SubprocessError) as error:
        print(f"Signierung gestoppt: {error}\nEs wurde nichts automatisch erneuert. Profil/Zertifikat bewusst prüfen; Safari-Zertifikat nicht widerrufen.", file=sys.stderr)
        return 1
    print(f"Lokale Signierung geprüft: {profile['UUID']}, gültig bis {utc(profile['ExpirationDate']).isoformat()}, Zertifikat {args.identity}.", file=sys.stderr)
    if not args.sign_app:
        print(profile["UUID"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
