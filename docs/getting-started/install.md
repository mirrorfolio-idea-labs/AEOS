# Install

AEOS runs on Linux and macOS. On Windows, use WSL2 and the command-line
install. There are three ways in: the desktop app, a one-line command-line
install, or a build from source.

<!-- aeos:component InstallPicker -->

## Desktop app

The desktop app starts the AEOS daemon for you, opens the web UI in its own
window, and shows a notification when an agent needs you. Download it from
the [Releases page](https://github.com/mirrorfolio-idea-labs/AEOS/releases):

| Platform | File |
|---|---|
| macOS (Apple silicon) | `AEOS_<version>_aarch64.dmg` |
| Linux, any distribution | `AEOS_<version>_amd64.AppImage` |
| Debian and Ubuntu | `AEOS_<version>_amd64.deb` |
| Arch Linux | `aeos-<version>-x86_64.pkg.tar.zst`, installed with `sudo pacman -U` |

On Arch you can also build the package yourself from a clone:
`cd packaging/arch && makepkg -si`.

## Command line

This installs the daemon (`aeosd`) and the CLI (`aeos`) for your user. The
bundle carries its own Node runtime, so the only requirement is git:

```bash
curl -fsSL https://mirrorfolio-idea-labs.github.io/AEOS/install.sh | sh
```

The installer checks the download against the release's `SHA256SUMS` and
refuses to install on a mismatch. If `cosign` is installed, it also verifies
the release signature. Set `AEOS_REQUIRE_SIGNATURE=1` to make that check
mandatory.

Useful settings:

- `AEOS_VERSION=v1.0.0` installs a specific release instead of the latest.
- `AEOS_BIN_DIR` changes where the `aeos` and `aeosd` commands go (the
  default is `~/.local/bin`).

Update later with `aeos update`, which re-runs the same verified install.

## From source

You need Node.js 22 and git; pnpm comes with Node through `corepack`:

```bash
git clone https://github.com/mirrorfolio-idea-labs/AEOS.git
cd AEOS && corepack enable
pnpm install && pnpm build
```

Then start the daemon with `node apps/aeosd/dist/main.js run`.

## Next

[The quickstart](quickstart.md) starts the daemon and runs a first
objective in about five minutes.
