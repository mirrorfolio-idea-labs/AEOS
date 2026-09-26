//! P2.M8.T1 accept: the shell cold-starts the daemon if absent (and reuses a
//! running one), then quits cleanly — SIGTERM, not SIGKILL, for a daemon it owns.

use std::net::TcpListener;
use std::path::PathBuf;
use std::time::Duration;

use aeos_desktop_lib::daemon::{ensure_daemon, healthy};

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
}

#[test]
fn cold_starts_when_absent_reuses_when_present_and_stops_cleanly() {
    let port = free_port();
    let base = format!("http://127.0.0.1:{port}");
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fake-aeosd.mjs");
    let marker = std::env::temp_dir().join(format!("aeos-desktop-{port}.marker"));
    let _ = std::fs::remove_file(&marker);
    std::env::set_var("AEOS_PORT", port.to_string());
    std::env::set_var("FAKE_MARKER", &marker);
    std::env::set_var("AEOS_DAEMON_CMD", format!("node {}", fixture.display()));

    assert!(!healthy(&base), "nothing listens yet");
    let owned = ensure_daemon(&base, Duration::from_secs(15)).expect("cold start").expect("we own it");
    assert!(healthy(&base));

    // a second shell (or a daemon started by the CLI) is reused, never owned
    assert!(ensure_daemon(&base, Duration::from_secs(5)).expect("reuse").is_none());

    owned.stop();
    assert!(!healthy(&base), "daemon is gone after quit");
    assert_eq!(std::fs::read_to_string(&marker).unwrap(), "stopped-cleanly");
}

#[test]
fn a_missing_daemon_binary_is_a_clear_error() {
    let port = free_port();
    std::env::set_var("AEOS_DAEMON_CMD", "/nonexistent/aeosd");
    let err = ensure_daemon(&format!("http://127.0.0.1:{port}"), Duration::from_secs(2))
        .err()
        .expect("spawn fails");
    assert!(err.to_string().contains("could not start aeosd"));
}
