#!/usr/bin/env bash
# Record a real Claude Code stream-json session as a test fixture.
#
# Usage: AEOS_FIXTURE_PROFILE_DIR=/tmp/aeos-record ./scripts/record-fixture.sh "objective" out.ndjson
#
# The recording is SCRUBBED before it may be committed:
#  - session_id values are rewritten to a stable placeholder
#  - anything matching sk-[A-Za-z0-9-]+ is rejected outright
# The committed *.expected.json goldens are frozen translations of these
# recordings — regenerate them with the translator when re-recording.
set -euo pipefail

objective="${1:?objective required}"
out="${2:?output path required}"
profile_dir="${AEOS_FIXTURE_PROFILE_DIR:?set AEOS_FIXTURE_PROFILE_DIR to a scratch dir}"

mkdir -p "$profile_dir"
CLAUDE_CONFIG_DIR="$profile_dir" claude -p "$objective" \
  --output-format stream-json --verbose --bare > "$out.raw"

if grep -qE 'sk-[A-Za-z0-9_-]{8,}' "$out.raw"; then
  echo "FATAL: recording contains something that looks like a secret — not writing fixture" >&2
  rm -f "$out.raw"
  exit 1
fi

sed -E 's/"session_id":"[^"]+"/"session_id":"prov-sess-recorded"/g' "$out.raw" > "$out"
rm -f "$out.raw"
echo "fixture written: $out (scrubbed)"
