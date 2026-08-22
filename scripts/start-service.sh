#!/usr/bin/env bash
set -euo pipefail

data_dir="${BH_DATA_DIR:-.wrangler/state}"
listen_host="${BH_LISTEN_HOST:-0.0.0.0}"
port="${PORT:-3007}"

if [[ "${BH_NODE_RUNTIME:-}" == "1" ]]; then
  database_path="${BH_DB_PATH:-$data_dir/bezenskova-house.sqlite}"
  mkdir -p "$(dirname "$database_path")"
  exec ./node_modules/.bin/vinext start --hostname "$listen_host" --port "$port"
fi

mkdir -p "$data_dir"

args=(
  dev
  --config dist/server/wrangler.json
  --local
  --ip "$listen_host"
  --port "$port"
  --persist-to "$data_dir"
  --log-level info
  --show-interactive-dev-session=false
)

if [[ -n "${BH_ENV_FILE:-}" ]]; then
  args+=(--env-file "$BH_ENV_FILE")
fi

exec ./node_modules/.bin/wrangler "${args[@]}"
