#!/usr/bin/env python3
"""Keep regenerated Safari projects from managing Apple certificates."""

import pathlib
import re
import sys


# Safari has its own selection. Changing iPhone signing must not change this.
SAFARI_IDENTITY = "E94E8C9CC2FF184832B68E4C02A332867D66F560"
SAFARI_TEAM = "RFN59MUTQ3"


def lock_project(source):
    def configure(match):
        settings = match.group(0)
        if "PRODUCT_BUNDLE_IDENTIFIER" not in settings:
            return settings
        for key, value in (
            ("CODE_SIGN_STYLE", "Manual"),
            ("CODE_SIGN_IDENTITY", SAFARI_IDENTITY),
            ("DEVELOPMENT_TEAM", SAFARI_TEAM),
        ):
            # Conditional SDK values take precedence over the ordinary key.
            # Lock those too, and always provide an unconditional setting.
            pattern = rf'(?m)^([ \t]*)("?{key}(?:\[[^\]\n]+\])?"?)\s*=\s*[^;\n]+;'
            settings = re.sub(pattern, rf"\g<1>\g<2> = {value};", settings)
            if not re.search(rf'(?m)^[ \t]*"?{key}"?\s*=', settings):
                settings = settings.replace(
                    "buildSettings = {",
                    f"buildSettings = {{\n\t\t\t\t{key} = {value};",
                    1,
                )
        return settings

    result = re.sub(r"buildSettings = \{.*?\n\s*\};", configure, source, flags=re.S)
    def configure_attributes(match):
        attributes = match.group(0)
        if re.search(r"\bProvisioningStyle\s*=", attributes):
            return re.sub(r"ProvisioningStyle\s*=\s*[^;]+;", "ProvisioningStyle = Manual;", attributes)
        return re.sub(
            r"(CreatedOnToolsVersion = [^;]+;)",
            r"\1\n\t\t\t\t\t\tProvisioningStyle = Manual;",
            attributes,
        )

    result = re.sub(
        r"\b[A-Fa-f0-9]{24}\s*=\s*\{[^{}]*CreatedOnToolsVersion[^{}]*\};",
        configure_attributes, result,
    )
    if re.search(r'"?(?:CODE_SIGN_STYLE(?:\[[^\]]+\])?|ProvisioningStyle)"?\s*=\s*Automatic\s*;', result):
        raise ValueError("Automatische Safari-Signierung wurde nicht vollständig entfernt.")
    if result.count("CODE_SIGN_STYLE = Manual;") < 4:
        raise ValueError("App-/Extension-Konfigurationen nicht vollständig erkannt.")
    return result


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Aufruf: lock-safari-signing.py PFAD_ZUM_GENERIERTEN_PROJEKTORDNER")
    projects = list(pathlib.Path(sys.argv[1]).rglob("project.pbxproj"))
    if len(projects) != 1:
        raise SystemExit("Genau ein generiertes Safari-Xcode-Projekt erwartet.")
    project = projects[0]
    project.write_text(lock_project(project.read_text()))
    print("Safari: manuelle Signierung mit festem vorhandenem Zertifikat; keine automatische Erneuerung.")
