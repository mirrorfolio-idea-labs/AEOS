//! Daemon lifecycle (P2.M8.T1): reuse a running `aeosd`, else cold-start one
//! and own it — the shell stops only a daemon it started itself.

use std::process::{Child, Command, Stdio};
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

/// How to launch the daemon: `AEOS_DAEMON_CMD` (whitespace-split, e.g.
/// `node /opt/aeos/aeosd/dist/main.js`), else `aeosd` on PATH.
pub fn daemon_command() -> Vec<String> {
    match std::env::var("AEOS_DAEMON_CMD") {
        Ok(cmd) if !cmd.trim().is_empty() => cmd.split_whitespace().map(str::to_string).collect(),
        _ => vec!["aeosd".to_string()],
    }
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
