#!/usr/bin/env bash
# Baut aus extension/ ein Xcode-Projekt für macOS und iOS.
# Auf dem Mac ausführen: bash scripts/convert-safari.sh
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Dieses Skript läuft nur auf dem Mac (xcrun safari-web-extension-converter)." >&2
  exit 1
fi

if ! xcrun --find safari-web-extension-converter >/dev/null 2>&1; then
  echo "safari-web-extension-converter fehlt. Xcode aus dem App Store installieren und einmal öffnen." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT="$ROOT/extension"
OUT="$ROOT/safari"

# Kein Plattform-Filter: ein Projekt für Mac und iPhone.
xcrun safari-web-extension-converter "$EXT" \
  --project-location "$OUT" \
  --app-name "Shorts ausblenden" \
  --bundle-identifier "de.ipekkaya.shorts-ausblenden" \
  --swift \
  --copy-resources \
  --force \
  --no-open \
  --no-prompt

# The converter defaults to automatic signing. Lock it before the generated
# project can be opened: iPhone provisioning must not rotate Safari's signer.
python3 "$ROOT/scripts/lock-safari-signing.py" "$OUT"

HANDLER="$ROOT/native/SafariWebExtensionHandler.swift"
copied=0
while IFS= read -r dest; do
  cp "$HANDLER" "$dest"
  copied=$((copied + 1))
done < <(find "$OUT" -name 'SafariWebExtensionHandler.swift' -print)
if [[ "$copied" -eq 0 ]]; then
  echo "SafariWebExtensionHandler.swift wurde im erzeugten Projekt nicht gefunden." >&2
  exit 1
fi

echo "Xcode-Projekt liegt unter: $OUT"
echo "Datei Shorts ausblenden.xcodeproj in Xcode öffnen."
echo "Die Kurzfassung läuft über das Modell auf dem Gerät (native messaging)."
