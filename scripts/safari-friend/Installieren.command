#!/bin/bash
# Optionaler lokaler Helfer für das entpackte Langform-Safari-Testpaket.
# Keine System- oder Safari-Einstellungen, keine Apple-Zertifikate ändern.
set -euo pipefail

TASK_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SOURCE_APP="$TASK_DIR/Langform Safari.app"
TARGET_DIR="$HOME/Applications"
TARGET_APP="$TARGET_DIR/Langform Safari.app"
GUIDE="$TASK_DIR/INSTALLIEREN.txt"
BACKUP_ROOT="$HOME/Library/Application Support/Langform Safari/Backups"
STAGING_PARENT=""
BACKUP_APP=""

fail() {
  printf '\nInstallation angehalten: %s\n' "$1" >&2
  printf 'Bitte verwende die manuellen Schritte in INSTALLIEREN.txt.\n' >&2
  exit 1
}

cleanup() {
  if [[ -n "$STAGING_PARENT" && -d "$STAGING_PARENT" ]]; then
    /bin/rm -rf -- "$STAGING_PARENT"
  fi
}
trap cleanup EXIT

[[ "$(/usr/bin/uname -s)" == "Darwin" ]] || fail "Dieser Helfer ist nur für macOS."
[[ -d "$SOURCE_APP" && -f "$SOURCE_APP/Contents/Info.plist" ]] ||
  fail "Langform Safari.app fehlt neben dem Helfer. Bitte das ZIP vollständig entpacken."
[[ -f "$GUIDE" ]] || fail "Die Installationsanleitung fehlt im Paket."

if ! /usr/bin/codesign --verify --deep --strict "$SOURCE_APP"; then
  fail "Die Unversehrtheitsprüfung der App ist fehlgeschlagen. Bitte ein neues Paket anfordern."
fi

/bin/mkdir -p -- "$TARGET_DIR"
STAGING_PARENT="$(/usr/bin/mktemp -d "$TARGET_DIR/.Langform-Safari-Install.XXXXXX")"
STAGING_APP="$STAGING_PARENT/Langform Safari.app"
/usr/bin/ditto --rsrc --extattr "$SOURCE_APP" "$STAGING_APP"

if ! /usr/bin/codesign --verify --deep --strict "$STAGING_APP"; then
  fail "Die kopierte App konnte nicht geprüft werden. Die vorhandene App bleibt erhalten."
fi

if [[ -e "$TARGET_APP" || -L "$TARGET_APP" ]]; then
  /bin/mkdir -p -- "$BACKUP_ROOT"
  BACKUP_NAME="Langform Safari-$(/bin/date '+%Y%m%d-%H%M%S')-$$.app.not-registered"
  BACKUP_APP="$BACKUP_ROOT/$BACKUP_NAME"
  /bin/mv -- "$TARGET_APP" "$BACKUP_APP"
  printf 'Vorhandene App gesichert: %s\n' "$BACKUP_APP"
fi

if ! /bin/mv -- "$STAGING_APP" "$TARGET_APP"; then
  if [[ -n "$BACKUP_APP" && ( -e "$BACKUP_APP" || -L "$BACKUP_APP" ) ]]; then
    /bin/mv -- "$BACKUP_APP" "$TARGET_APP" || true
  fi
  fail "Die neue App konnte nicht abgelegt werden. Bitte den Programme-Ordner prüfen."
fi

printf '\nApp abgelegt: %s\n' "$TARGET_APP"
printf 'Öffne die Anleitung und aktiviere danach die Erweiterung in Safari.\n'
printf 'Nach jedem vollständigen Safari-Beenden musst du nicht signierte Erweiterungen erneut erlauben.\n'

/usr/bin/open -R "$TARGET_APP" || true
/usr/bin/open "$GUIDE" || true
if ! /usr/bin/open "$TARGET_APP"; then
  printf '\nmacOS hat das Öffnen nicht bestätigt. Prüfe Datenschutz & Sicherheit → Dennoch öffnen.\n'
fi

printf '\nDie Safari-Aktivierung und der YouTube-Test sind noch manuell auszuführen.\n'
