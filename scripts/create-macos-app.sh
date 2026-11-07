#!/bin/bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { printf '%s\n' 'The Echo app launcher requires macOS.' >&2; exit 1; }
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
destination="${1:-$project_dir/Echo.app}"
[[ "$destination" == /* ]] || destination="$PWD/$destination"
[[ "$destination" == *.app ]] || { printf '%s\n' 'Destination must end in .app.' >&2; exit 1; }
if [[ -e "$destination" ]]; then
  marker=$(/usr/bin/plutil -extract EchoLauncherGenerated raw -o - "$destination/Contents/Info.plist" 2>/dev/null || true)
  [[ "$marker" == true ]] || { printf '%s\n' "Refusing to replace an unrelated app: $destination" >&2; exit 1; }
fi
stage=$(mktemp -d "${TMPDIR:-/tmp}/echo-app.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
app="$stage/Echo.app"
/usr/bin/osacompile -o "$app" "$project_dir/scripts/macos/launcher.applescript"
printf '%s' "$project_dir" > "$app/Contents/Resources/project-path.txt"
info="$app/Contents/Info.plist"
project_id=$(printf '%s' "$project_dir" | /usr/bin/shasum -a 256 | cut -c1-12)
/usr/bin/plutil -replace CFBundleIdentifier -string "local.echo-ai-history.launcher.$project_id" "$info"
/usr/bin/plutil -replace CFBundleDisplayName -string 'Echo 回声' "$info"
/usr/bin/plutil -replace CFBundleName -string Echo "$info"
/usr/bin/plutil -replace LSUIElement -bool YES "$info"
/usr/bin/plutil -insert EchoLauncherGenerated -bool YES "$info"
if command -v swift >/dev/null 2>&1; then
  if swift "$project_dir/scripts/macos/make-icon.swift" "$stage/icon.png"; then
    mkdir "$stage/Echo.iconset"
    for size in 16 32 128 256 512; do
      /usr/bin/sips -z "$size" "$size" "$stage/icon.png" --out "$stage/Echo.iconset/icon_${size}x${size}.png" >/dev/null
      double=$((size * 2))
      /usr/bin/sips -z "$double" "$double" "$stage/icon.png" --out "$stage/Echo.iconset/icon_${size}x${size}@2x.png" >/dev/null
    done
    /usr/bin/iconutil -c icns "$stage/Echo.iconset" -o "$app/Contents/Resources/applet.icns"
  else
    printf '%s\n' 'Using the default launcher icon; the custom icon could not be rendered.' >&2
  fi
fi
# Changes to the compiled applet's resources require a fresh local ad-hoc signature.
/usr/bin/codesign --force --sign - "$app"
mkdir -p -- "$(dirname -- "$destination")"
if [[ -e "$destination" ]]; then mv -- "$destination" "$stage/previous.app"; fi
if ! mv -- "$app" "$destination"; then
  [[ ! -e "$stage/previous.app" ]] || mv -- "$stage/previous.app" "$destination"
  exit 1
fi
printf 'Created %s\nDouble-click it to start Echo and open the home page.\n' "$destination"
