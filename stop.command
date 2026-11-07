#!/bin/bash
set -euo pipefail
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
exec /bin/bash "$project_dir/scripts/echo.sh" stop "$@"
