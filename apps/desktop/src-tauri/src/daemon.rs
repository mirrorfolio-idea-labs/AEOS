//! Daemon lifecycle (P2.M8.T1): reuse a running `aeosd`, else cold-start one
//! and own it — the shell stops only a daemon it started itself.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::OnceLock;
use std::thread::sleep;
use std::time::{Duration, Instant};

/// The daemon base URL: `AEOS_URL`, else `http://127.0.0.1:<AEOS_PORT|7777>`.
pub fn base_url() -> String {
    if let Ok(url) = std::env::var("AEOS_URL") {
        return url.trim_end_matches('/').to_string();
    }
    let port = std::env::var("AEOS_PORT").unwrap_or_else(|_| "7777".to_string());
    format!("http://127.0.0.1:{port}")
}

pub fn healthy(base: &str) -> bool {
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_millis(800)))
        .build()
        .new_agent();
    agent
        .get(format!("{base}/v1/health"))
        .call()
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

/// The daemon shipped inside the installer (P5.M6.T4): one resource, the same
/// self-contained `aeos-<version>-<os>-<arch>.tar.gz` the CLI installer uses.
struct Bundled {
    tarball: PathBuf,
    version: String,
}
static BUNDLED: OnceLock<Bundled> = OnceLock::new();

pub fn set_bundled_daemon(tarball: PathBuf, version: String) {
    let _ = BUNDLED.set(Bundled { tarball, version });
}

/// Where versions live: `AEOS_INSTALL_DIR`, else `~/.aeos/app`, the same
/// layout install.sh uses, so app and CLI installs share one version store.
pub fn install_dir() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("AEOS_INSTALL_DIR") {
        return Some(PathBuf::from(dir));
    }
    std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".aeos").join("app"))
}

/// Unpacks the bundled daemon into `<install_dir>/versions/<version>` once
/// (into a `.partial` dir renamed into place, so an interrupted first run never
/// leaves a half-installed version) and returns its `bin/aeosd`.
pub fn ensure_bundled_daemon(tarball: &Path, install_dir: &Path, version: &str) -> Result<PathBuf, String> {
    let dest = install_dir.join("versions").join(version);
    let aeosd = dest.join("bin").join("aeosd");
    if aeosd.is_file() {
        return Ok(aeosd);
    }
    if !tarball.is_file() {
        return Err(format!("no bundled daemon at {}", tarball.display()));
    }
    let partial = install_dir.join("versions").join(format!("{version}.partial"));
    let _ = std::fs::remove_dir_all(&partial);
    std::fs::create_dir_all(&partial).map_err(|e| format!("{}: {e}", partial.display()))?;
    let status = Command::new("tar")
        .arg("-xzf")
        .arg(tarball)
        .arg("-C")
        .arg(&partial)
        .arg("--strip-components=1")
        .status()
        .map_err(|e| format!("tar: {e}"))?;
    if !status.success() || !partial.join("bin").join("aeosd").is_file() {
        let _ = std::fs::remove_dir_all(&partial);
        return Err(format!("could not unpack {}", tarball.display()));
    }
    let _ = std::fs::remove_dir_all(&dest);
    std::fs::rename(&partial, &dest).map_err(|e| format!("{}: {e}", dest.display()))?;
    Ok(aeosd)
}

/// The resolution rule, pure for testing: `AEOS_DAEMON_CMD` (whitespace-split,
/// e.g. `node /opt/aeos/aeosd/dist/main.js`), else the daemon bundled with this
/// app (so a cold start runs the version the app shipped with), else `aeosd`
/// on PATH (the Arch package installs /usr/bin/aeosd).
pub fn resolve_daemon_command(env_cmd: Option<&str>, bundled: Option<&Path>) -> Vec<String> {
    match env_cmd {
        Some(cmd) if !cmd.trim().is_empty() => cmd.split_whitespace().map(str::to_string).collect(),
        _ => match bundled {
            Some(path) if path.is_file() => vec![path.to_string_lossy().into_owned()],
            _ => vec!["aeosd".to_string()],
        },
    }
}

pub fn daemon_command() -> Vec<String> {
    let env_cmd = std::env::var("AEOS_DAEMON_CMD").ok();
    let bundled = match (env_cmd.as_deref().map(str::trim), BUNDLED.get(), install_dir()) {
        (None | Some(""), Some(b), Some(dir)) => match ensure_bundled_daemon(&b.tarball, &dir, &b.version) {
            Ok(path) => Some(path),
            Err(e) => {
                // a build without the resource (e.g. the Arch package) is normal
                if b.tarball.is_file() {
                    eprintln!("bundled daemon unavailable ({e}); trying aeosd on PATH");
                }
                None
            }
        },
        _ => None,
    };
    resolve_daemon_command(env_cmd.as_deref(), bundled.as_deref())
}

pub struct OwnedDaemon {
    child: Child,
}

impl OwnedDaemon {
    /// Graceful stop: SIGTERM (aeosd drains and exits), SIGKILL after 5 s.
    pub fn stop(mut self) {
        #[cfg(unix)]
        {
            let _ = Command::new("kill").arg("-TERM").arg(self.child.id().to_string()).status();
            let deadline = Instant::now() + Duration::from_secs(5);
            while Instant::now() < deadline {
                if matches!(self.child.try_wait(), Ok(Some(_))) {
                    return;
                }
                sleep(Duration::from_millis(100));
            }
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Debug)]
pub enum StartError {
    Spawn(String),
    NotHealthy(String),
}

impl std::fmt::Display for StartError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StartError::Spawn(m) => write!(f, "could not start aeosd: {m}"),
            StartError::NotHealthy(m) => write!(f, "aeosd did not become healthy: {m}"),
        }
    }
}

/// `Ok(None)` = a daemon was already up (not ours); `Ok(Some)` = we started it.
pub fn ensure_daemon(base: &str, timeout: Duration) -> Result<Option<OwnedDaemon>, StartError> {
    if healthy(base) {
        return Ok(None);
    }
    let argv = daemon_command();
    let (program, args) = argv.split_first().ok_or_else(|| StartError::Spawn("empty AEOS_DAEMON_CMD".into()))?;
    let mut child = Command::new(program)
        .args(args)
        .arg("run")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| StartError::Spawn(format!("{program}: {e}")))?;
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if let Ok(Some(status)) = child.try_wait() {
            return Err(StartError::NotHealthy(format!("exited early with {status}")));
        }
        if healthy(base) {
            return Ok(Some(OwnedDaemon { child }));
        }
        sleep(Duration::from_millis(200));
    }
    let _ = child.kill();
    Err(StartError::NotHealthy(format!("no /v1/health after {}s", timeout.as_secs())))
}

#[cfg(test)]
mod tests {
    use super::{ensure_bundled_daemon, resolve_daemon_command};
    use std::path::Path;
    use std::process::Command;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("aeos-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn env_command_wins_then_the_bundled_daemon_then_path() {
        let dir = scratch("resolve");
        let bundled = dir.join("aeosd");
        std::fs::write(&bundled, "#!/bin/sh\n").unwrap();
        assert_eq!(resolve_daemon_command(Some("node /x/main.js"), Some(&bundled)), vec!["node", "/x/main.js"]);
        assert_eq!(resolve_daemon_command(None, Some(&bundled)), vec![bundled.to_string_lossy().into_owned()]);
        assert_eq!(resolve_daemon_command(Some("  "), Some(&bundled)).len(), 1);
        // a bundled path that is not there (e.g. the Arch package) falls back to PATH
        assert_eq!(resolve_daemon_command(None, Some(Path::new("/nope/aeosd"))), vec!["aeosd"]);
        assert_eq!(resolve_daemon_command(None, None), vec!["aeosd"]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn unpacks_the_bundled_daemon_once_into_the_shared_version_store() {
        let dir = scratch("unpack");
        let src = dir.join("aeos-9.9.9-linux-x64");
        std::fs::create_dir_all(src.join("bin")).unwrap();
        std::fs::write(src.join("bin").join("aeosd"), "#!/bin/sh\n").unwrap();
        let tarball = dir.join("daemon.tar.gz");
        assert!(Command::new("tar")
            .arg("-czf")
            .arg(&tarball)
            .arg("-C")
            .arg(&dir)
            .arg("aeos-9.9.9-linux-x64")
            .status()
            .unwrap()
            .success());

        let store = dir.join("app");
        let aeosd = ensure_bundled_daemon(&tarball, &store, "9.9.9").unwrap();
        assert_eq!(aeosd, store.join("versions").join("9.9.9").join("bin").join("aeosd"));
        assert!(aeosd.is_file());
        assert!(!store.join("versions").join("9.9.9.partial").exists());

        // second run: already installed, the tarball is not needed
        std::fs::remove_file(&tarball).unwrap();
        assert_eq!(ensure_bundled_daemon(&tarball, &store, "9.9.9").unwrap(), aeosd);
        // a missing tarball for a new version is a clear error, nothing half-installed
        assert!(ensure_bundled_daemon(&tarball, &store, "10.0.0").is_err());
        assert!(!store.join("versions").join("10.0.0").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
