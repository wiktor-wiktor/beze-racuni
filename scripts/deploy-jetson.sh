#!/usr/bin/env bash
set -euo pipefail

target="${BH_JETSON_TARGET:?Set BH_JETSON_TARGET to the Nano SSH target, for example c@c-desktop}"
remote_root="${BH_REMOTE_ROOT:-.local/share/bezenskova-house}"
service_name="${BH_CONTAINER_NAME:-bezenskova-house}"
port="${BH_PORT:-3007}"
platform="linux/arm64"
source_database_name="faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite"
database_name="bezenskova-house.sqlite"
local_database=".wrangler/state/v3/d1/miniflare-D1DatabaseObject/$source_database_name"
release="$(git rev-parse --short HEAD 2>/dev/null || printf local)-$(date -u +%Y%m%d%H%M%S)"
image="bezenskova-house:$release"
seed_dir="$(mktemp -d)"
seed_database="$seed_dir/$database_name"

cleanup() {
  if [[ -d "$seed_dir" ]]; then
    find "$seed_dir" -type f -delete
    rmdir "$seed_dir"
  fi
}
trap cleanup EXIT

if [[ ! -f "$local_database" ]]; then
  printf 'Local database not found: %s\n' "$local_database" >&2
  exit 1
fi

printf 'Testing and building %s for %s...\n' "$image" "$platform"
npm test
docker build --platform "$platform" --tag "$image" .

printf 'Creating a consistent seed snapshot...\n'
sqlite3 "$local_database" ".backup '$seed_database'"
integrity="$(sqlite3 "$seed_database" 'PRAGMA integrity_check;')"
if [[ "$integrity" != "ok" ]]; then
  printf 'Seed database integrity check failed: %s\n' "$integrity" >&2
  exit 1
fi

ssh "$target" bash -s -- "$remote_root" <<'REMOTE_PREPARE'
set -euo pipefail
remote_root="$1"
if [[ "$remote_root" != /* ]]; then
  remote_root="$HOME/$remote_root"
fi
mkdir -p "$remote_root/data" "$remote_root/incoming"
REMOTE_PREPARE
scp "$seed_database" "$target:$remote_root/incoming/$database_name"

printf 'Transferring container image to %s...\n' "$target"
docker save "$image" | gzip | ssh "$target" 'gzip -d | docker load >/dev/null'

ssh "$target" bash -s -- "$remote_root" "$service_name" "$port" "$image" "$database_name" <<'REMOTE'
set -euo pipefail

remote_root="$1"
if [[ "$remote_root" != /* ]]; then
  remote_root="$HOME/$remote_root"
fi
service_name="$2"
port="$3"
image="$4"
database_name="$5"
data_dir="$remote_root/data"
database="$data_dir/$database_name"
incoming="$remote_root/incoming/$database_name"
env_file="$remote_root/app.env"

if [[ ! -f "$database" ]]; then
  install -m 600 "$incoming" "$database"
  printf 'Seeded persistent database from the local snapshot.\n'
else
  printf 'Persistent database already exists; leaving it unchanged.\n'
fi
find "$remote_root/incoming" -type f -name "$database_name" -delete

if [[ ! -f "$env_file" ]]; then
  umask 077
  printf 'ADMIN_PASSWORD=rachunki123#\n' > "$env_file"
elif grep -qx 'ADMIN_PASSWORD="rachunki123#"' "$env_file"; then
  # Docker treats quotes as value characters, unlike Wrangler's dotenv parser.
  printf 'ADMIN_PASSWORD=rachunki123#\n' > "$env_file"
fi

previous_image=""
if docker container inspect "$service_name" >/dev/null 2>&1; then
  previous_image="$(docker container inspect --format '{{.Config.Image}}' "$service_name")"
  docker container stop "$service_name" >/dev/null
  docker container rm "$service_name" >/dev/null
fi

start_container() {
  local selected_image="$1"
  docker run --detach \
    --name "$service_name" \
    --restart unless-stopped \
    --publish "$port:3007" \
    --volume "$data_dir:/data" \
    --env-file "$env_file" \
    --env BH_DATA_DIR=/data \
    --env BH_DB_PATH=/data/bezenskova-house.sqlite \
    --env BH_NODE_RUNTIME=1 \
    "$selected_image" >/dev/null
}

start_container "$image"

healthy=false
for _ in $(seq 1 30); do
  if curl --fail --silent --show-error "http://127.0.0.1:$port/api/app" >/dev/null; then
    healthy=true
    break
  fi
  sleep 1
done

if [[ "$healthy" != true ]]; then
  docker logs --tail 100 "$service_name" >&2 || true
  docker container rm --force "$service_name" >/dev/null 2>&1 || true
  if [[ -n "$previous_image" ]]; then
    printf 'New release failed its health check; restoring %s.\n' "$previous_image" >&2
    start_container "$previous_image"
  fi
  exit 1
fi

mapfile -t stale_images < <(
  docker images --filter reference='bezenskova-house:*' --format '{{.Repository}}:{{.Tag}}' |
    awk -v current="$image" '$0 != current' |
    tail -n +3
)
if (( ${#stale_images[@]} > 0 )); then
  docker image rm "${stale_images[@]}" >/dev/null
fi

printf 'Service is healthy on port %s using %s.\n' "$port" "$image"
REMOTE

printf 'Deployment complete.\n'
