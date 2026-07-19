#!/usr/bin/env bash
# Record a real OpenCode --format json session as a test fixture (scrubbed).
# Usage: AEOS_FIXTURE_PROFILE_DIR=/tmp/aeos-oc-record ./scripts/record-fixture.sh "objective" out.ndjson
set -euo pipefail

objective="${1:?objective required}"
out="${2:?output path required}"
profile_dir="${AEOS_FIXTURE_PROFILE_DIR:?set AEOS_FIXTURE_PROFILE_DIR to a scratch dir}"

mkdir -p "$profile_dir"/{config,data,state,cache}
XDG_CONFIG_HOME="$profile_dir/config" XDG_DATA_HOME="$profile_dir/data" \
XDG_STATE_HOME="$profile_dir/state" XDG_CACHE_HOME="$profile_dir/cache" \
OPENCODE_DISABLE_PROJECT_CONFIG=1 \
  opencode run "$objective" --format json > "$out.raw"

if grep -qE 'sk-[A-Za-z0-9_-]{8,}' "$out.raw"; then
  echo "FATAL: recording contains something that looks like a secret — not writing fixture" >&2
  rm -f "$out.raw"
  exit 1
fi

sed -E 's/"sessionID":"[^"]+"/"sessionID":"ses_recorded"/g' "$out.raw" > "$out"
rm -f "$out.raw"
echo "fixture written: $out (scrubbed)"
