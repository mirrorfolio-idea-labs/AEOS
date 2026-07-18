# Security Policy

AEOS runs autonomous coding agents with real credentials on real machines —
security reports are taken seriously and handled with priority.

## Supported versions

Pre-1.0: only the latest tagged release and `main` receive security fixes.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Preferred: use GitHub's private vulnerability reporting —
[Report a vulnerability](https://github.com/mirrorfolio-idea-labs/AEOS/security/advisories/new).

Alternatively, email **kabeer@mirrorfolio.com** with subject
`[AEOS SECURITY]`, including:

- affected component/version (daemon, runner, provider, UI, contracts)
- reproduction steps or proof of concept
- impact assessment (what an attacker gains)

You will receive an acknowledgment within **3 business days** and a
triage decision (accepted/declined + severity) within **7 days**. Fixes for
confirmed vulnerabilities are prioritized ahead of roadmap work, and you
will be credited in the release notes unless you prefer otherwise.

## Scope notes

Especially interesting areas, given what AEOS does:

- secret leakage into transcripts, events, worktrees, or generated harness
  profiles (redaction pipeline)
- policy-engine bypasses (an agent acting beyond its permission tier)
- sandbox/worktree escapes from runner child processes
- the daemon's local socket/API surface (auth, injection)
