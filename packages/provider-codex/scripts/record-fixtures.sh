#!/usr/bin/env bash
# Records golden fixtures from REAL codex runs (spec §18). Requires:
#   - codex CLI installed + authenticated (codex login status)
#   - network access; costs one trivial ChatGPT-plan request per fixture
# Re-recording replaces whole files; never hand-edit the outputs.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=test/fixtures
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
git init -q "$WORK/repo" && cd "$WORK/repo"

echo ">> recording session.ndjson (command execution)"
codex exec --skip-git-repo-check --sandbox danger-full-access \
  'Run the shell command "echo fixture-marker-42" and show me its output.' \
  --json </dev/null > "$OLDPWD/$OUT/session.ndjson"

echo ">> recording resume.ndjson (resume --last continuation)"
codex exec resume --last \
  'What was the exact output of the command you ran? Answer in one short line.' \
  --json </dev/null > "$OLDPWD/$OUT/resume.ndjson"

echo ">> recorded: $(wc -l < "$OLDPWD/$OUT/session.ndjson") + $(wc -l < "$OLDPWD/$OUT/resume.ndjson") lines"
