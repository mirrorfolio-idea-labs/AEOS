#!/bin/sh
# AEOS installer (P5.M6.T3). Installs the self-contained daemon + CLI bundle
# from a GitHub Release, verified before anything is unpacked:
#
#   curl -fsSL https://mirrorfolio-idea-labs.github.io/AEOS/install.sh | sh
#
# - the bundle's SHA-256 must match the release's SHA256SUMS, or nothing is
#   installed;
# - when `cosign` is on PATH, SHA256SUMS must carry the release pipeline's
#   keyless signature (GitHub OIDC identity of this repository), or nothing is
#   installed. AEOS_REQUIRE_SIGNATURE=1 makes a missing cosign an error too.
#
# Environment (all optional):
#   AEOS_VERSION            release tag to install (default: the latest release)
#   AEOS_INSTALL_DIR        where versions live (default: ~/.aeos/app)
#   AEOS_BIN_DIR            where the aeos/aeosd commands go (default: ~/.local/bin)
#   AEOS_REQUIRE_SIGNATURE  1 = refuse to install without cosign verification
#   AEOS_RELEASES_URL       release download base (default: GitHub); tests use a mirror
#
# The bundle carries its own Node runtime; the only host requirement is git.
set -eu

REPO="mirrorfolio-idea-labs/AEOS"
RELEASES_URL="${AEOS_RELEASES_URL:-https://github.com/$REPO/releases}"
INSTALL_DIR="${AEOS_INSTALL_DIR:-$HOME/.aeos/app}"
# a custom bin dir chosen at first install is remembered for `aeos update`
if [ -z "${AEOS_BIN_DIR:-}" ] && [ -f "$INSTALL_DIR/.bin-dir" ]; then AEOS_BIN_DIR="$(cat "$INSTALL_DIR/.bin-dir")"; fi
BIN_DIR="${AEOS_BIN_DIR:-$HOME/.local/bin}"

say() { printf '%s\n' "aeos-install: $*"; }
die() { printf '%s\n' "aeos-install: error: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required but not installed"; }

need curl
need tar
need uname

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=macos ;;
  *) die "unsupported OS $(uname -s): AEOS runs on Linux and macOS (on Windows, use WSL2)" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) die "unsupported CPU $(uname -m)" ;;
esac

# the latest release, resolved through GitHub's redirect (no API rate limit)
if [ -n "${AEOS_VERSION:-}" ]; then
  tag="$AEOS_VERSION"
else
  latest="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "$RELEASES_URL/latest")" \
    || die "could not resolve the latest release from $RELEASES_URL/latest"
  tag="${latest##*/}"
fi
case "$tag" in v[0-9]*) ;; *) die "could not determine a release tag (got '$tag')" ;; esac
version="${tag#v}"

bundle="aeos-$version-$os-$arch.tar.gz"
base="$RELEASES_URL/download/$tag"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/aeos-install.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT INT TERM

say "installing AEOS $tag for $os-$arch"
curl -fsSL -o "$tmp/SHA256SUMS" "$base/SHA256SUMS" || die "no SHA256SUMS in release $tag"
grep -q " $bundle\$" "$tmp/SHA256SUMS" \
  || die "release $tag has no bundle for $os-$arch ($bundle); see $RELEASES_URL/tag/$tag"

# signature over SHA256SUMS: checked whenever cosign is available
if command -v cosign >/dev/null 2>&1; then
  curl -fsSL -o "$tmp/SHA256SUMS.sigstore.json" "$base/SHA256SUMS.sigstore.json" \
    || die "release $tag has no SHA256SUMS signature; refusing to install"
  cosign verify-blob "$tmp/SHA256SUMS" \
    --bundle "$tmp/SHA256SUMS.sigstore.json" \
    --certificate-identity-regexp "^https://github.com/$REPO/" \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com >/dev/null 2>&1 \
    || die "SHA256SUMS signature verification FAILED; refusing to install"
  say "signature verified (cosign, GitHub OIDC identity of $REPO)"
elif [ "${AEOS_REQUIRE_SIGNATURE:-0}" = 1 ]; then
  die "AEOS_REQUIRE_SIGNATURE=1 but cosign is not installed"
else
  say "cosign not found: checking the SHA-256 only (install cosign to also verify the signature)"
fi

curl -fsSL -o "$tmp/$bundle" "$base/$bundle" || die "download failed: $base/$bundle"
expected="$(grep " $bundle\$" "$tmp/SHA256SUMS" | awk '{print $1}')"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp/$bundle" | awk '{print $1}')"
else
  actual="$(shasum -a 256 "$tmp/$bundle" | awk '{print $1}')"
fi
[ -n "$expected" ] && [ "$actual" = "$expected" ] \
  || die "checksum mismatch for $bundle (expected $expected, got $actual); refusing to install"
say "checksum verified"

# versions side by side; `current` points at the active one
dest="$INSTALL_DIR/versions/$version"
rm -rf "$dest.partial"
mkdir -p "$dest.partial"
tar -xzf "$tmp/$bundle" -C "$dest.partial" --strip-components=1
[ -x "$dest.partial/bin/aeosd" ] || die "bundle is missing bin/aeosd"
rm -rf "$dest"
mv "$dest.partial" "$dest"
ln -sfn "versions/$version" "$INSTALL_DIR/current"

mkdir -p "$BIN_DIR"
printf '%s\n' "$BIN_DIR" > "$INSTALL_DIR/.bin-dir"
for cmd in aeos aeosd; do
  cat > "$BIN_DIR/$cmd" <<EOF
#!/bin/sh
exec "$INSTALL_DIR/current/bin/$cmd" "\$@"
EOF
  chmod 755 "$BIN_DIR/$cmd"
done

say "installed AEOS $tag to $dest"
command -v git >/dev/null 2>&1 || say "note: AEOS needs git on PATH to run agents; install git"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) say "add $BIN_DIR to your PATH, e.g.:  echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.profile" ;;
esac
cat <<EOF

  Start the daemon:   aeosd run            (web UI on http://127.0.0.1:7777)
  Keep it running:    aeos service install
  Update later:       aeos update
  Docs:               https://mirrorfolio-idea-labs.github.io/AEOS/

EOF
