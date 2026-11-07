#!/bin/bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
shopt -s nullglob
if [[ -n "${ECHO_NODE:-}" ]]; then
  candidates=("$ECHO_NODE")
else
  candidates=(
    "$(command -v node || true)"
    "$HOME/.local/bin/node" /opt/homebrew/bin/node /usr/local/bin/node
    "$HOME/.volta/bin/node" "$HOME/.asdf/shims/node"
    "$HOME"/.nvm/versions/node/*/bin/node
    "$HOME"/.local/share/fnm/node-versions/*/installation/bin/node
    "$HOME"/Library/Application\ Support/fnm/node-versions/*/installation/bin/node
    "$HOME"/.local/share/mise/installs/node/*/bin/node
  )
fi
for candidate in "${candidates[@]}"; do
  [[ -x "$candidate" ]] || continue
  if "$candidate" -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 13) ? 0 : 1)' >/dev/null 2>&1; then
    export PATH="$(dirname -- "$candidate"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
    exec "$candidate" "$project_dir/scripts/launcher.mjs" "$@"
  fi
done
printf '%s\n' 'Echo requires Node.js 22.13 or later. Install Node, or set ECHO_NODE to its absolute executable path.' >&2
exit 1
