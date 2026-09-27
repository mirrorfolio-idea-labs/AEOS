//! In-app updates (P5.M6.T4), through tauri-plugin-updater. Dormant unless a
//! release build compiled in the updater public key (AEOS_UPDATER_PUBKEY):
//! local builds, dry runs and distro packages (pacman updates the Arch one)
//! never register it. Stable builds follow `updates/latest.json`, release
//! candidates `updates/next.json` (GitHub's releases/latest skips
//! pre-releases), both published with the site.

/// The updater public key baked in at build time, if any.
pub const PUBKEY: Option<&str> = option_env!("AEOS_UPDATER_PUBKEY");

pub fn enabled() -> bool {
    PUBKEY.is_some_and(|k| !k.trim().is_empty())
}

/// The update channel manifest for a running version.
pub fn manifest_url(version: &str) -> String {
    let channel = if version.contains('-') { "next" } else { "latest" };
    format!("https://mirrorfolio-idea-labs.github.io/AEOS/updates/{channel}.json")
}

/// Checks once at startup; a found update is downloaded and installed in the
/// background, and a notification says to restart. Failures only log.
pub fn check_in_background(app: tauri::AppHandle) {
    use tauri_plugin_updater::UpdaterExt;
    if !enabled() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let version = app.package_info().version.to_string();
        let endpoint = match manifest_url(&version).parse() {
            Ok(url) => url,
            Err(_) => return,
        };
        let updater = match app.updater_builder().endpoints(vec![endpoint]).and_then(|b| b.build()) {
            Ok(updater) => updater,
            Err(e) => return eprintln!("updater: {e}"),
        };
        match updater.check().await {
            Ok(Some(update)) => {
                let next = update.version.clone();
                match update.download_and_install(|_, _| {}, || {}).await {
                    Ok(()) => {
                        let _ = notify_rust::Notification::new()
                            .appname("AEOS")
                            .summary(&format!("AEOS {next} is ready"))
                            .body("Restart AEOS to use the new version.")
                            .show();
                    }
                    Err(e) => eprintln!("updater: installing {next} failed: {e}"),
                }
            }
            Ok(None) => {}
            Err(e) => eprintln!("updater: {e}"),
        }
    });
}

#[cfg(test)]
mod tests {
    use super::manifest_url;

    #[test]
    fn release_candidates_follow_next_and_stable_builds_follow_latest() {
        assert!(manifest_url("1.0.0-rc.1").ends_with("/updates/next.json"));
        assert!(manifest_url("1.0.0").ends_with("/updates/latest.json"));
        assert!(manifest_url("1.2.3").starts_with("https://mirrorfolio-idea-labs.github.io/AEOS/"));
    }
}
