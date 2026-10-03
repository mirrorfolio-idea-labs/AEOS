//! AEOS desktop shell (P2.M8, spec §14 / D4): a thin Tauri window around the
//! daemon-served ADE. No UI logic is forked here — the shell only
//! (1) makes sure a daemon is running, (2) points the webview at it,
//! (3) turns `agent.status_changed` events into native notifications, and
//! (4) routes `aeos://` deep links to ADE views.

pub mod daemon;
pub mod links;
pub mod platform;
pub mod update;

use std::io::{BufRead, BufReader};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Manager, RunEvent, Url, WebviewWindow};
use tauri_plugin_deep_link::DeepLinkExt;

use crate::daemon::OwnedDaemon;
use crate::links::{alert_for_event, parse_deep_link, view_url, View};

struct Shell {
    base: String,
    owned: Mutex<Option<OwnedDaemon>>,
}

fn navigate(window: &WebviewWindow, base: &str, view: Option<&View>) {
    if let Ok(url) = Url::parse(&view_url(base, view)) {
        let _ = window.navigate(url);
    }
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

fn open_deep_links(app: &tauri::AppHandle, urls: impl IntoIterator<Item = String>) {
    let Some(window) = app.get_webview_window("main") else { return };
    let base = app.state::<Shell>().base.clone();
    for url in urls {
        navigate(&window, &base, parse_deep_link(&url).as_ref());
    }
}

/// SSE watcher: reconnects forever (the daemon may restart underneath us).
fn watch_attention(app: tauri::AppHandle, base: String) {
    std::thread::spawn(move || loop {
        let url = format!("{base}/v1/events?typePrefix=agent.status_changed");
        if let Ok(response) = ureq::get(&url).call() {
            let reader = BufReader::new(response.into_body().into_reader());
            for line in reader.lines() {
                let Ok(line) = line else { break };
                let Some(data) = line.strip_prefix("data: ") else { continue };
                if let Some(alert) = alert_for_event(data) {
                    notify(&app, &base, alert);
                }
            }
        }
        std::thread::sleep(Duration::from_secs(2));
    });
}

fn notify(app: &tauri::AppHandle, base: &str, alert: links::Alert) {
    let mut notification = notify_rust::Notification::new();
    notification.appname("AEOS").summary(&alert.title).body(&alert.body);
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // Linux: clicking the notification (default action) opens the view
        notification.action("default", "Open");
        if let Ok(handle) = notification.show() {
            let app = app.clone();
            let base = base.to_string();
            std::thread::spawn(move || {
                handle.wait_for_action(|action| {
                    if action == "default" {
                        if let Some(window) = app.get_webview_window("main") {
                            navigate(&window, &base, Some(&alert.view));
                        }
                    }
                });
            });
        }
    }
    #[cfg(any(target_os = "macos", windows))]
    {
        // macOS/Windows: show the notification and bring the view forward
        let _ = notification.show();
        if let Some(window) = app.get_webview_window("main") {
            if let Ok(url) = Url::parse(&view_url(base, Some(&alert.view))) {
                let _ = window.navigate(url);
            }
            let _ = window.request_user_attention(Some(tauri::UserAttentionType::Informational));
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    platform::apply_webview_workarounds();
    let base = daemon::base_url();
    let builder = tauri::Builder::default()
        // a second launch (e.g. an `aeos://` link) forwards to the running app
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            open_deep_links(app, argv.into_iter().filter(|a| a.starts_with("aeos://")));
        }))
        .plugin(tauri_plugin_deep_link::init());
    // P5.M6.T4: only release builds with a compiled-in updater key register it
    let builder = if update::enabled() {
        builder.plugin(tauri_plugin_updater::Builder::new().pubkey(update::PUBKEY.unwrap_or_default()).build())
    } else {
        builder
    };
    let app = builder
        .manage(Shell { base: base.clone(), owned: Mutex::new(None) })
        .setup(move |app| {
            // P5.M6.T4: installers ship the daemon as one resource
            if let Ok(resources) = app.path().resource_dir() {
                daemon::set_bundled_daemon(
                    resources.join("daemon.tar.gz"),
                    app.package_info().version.to_string(),
                );
            }
            #[cfg(any(target_os = "linux", windows))]
            let _ = app.deep_link().register_all();
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                open_deep_links(&handle, event.urls().into_iter().map(|u| u.to_string()));
            });

            update::check_in_background(app.handle().clone());

            let handle = app.handle().clone();
            let base = base.clone();
            let initial = app.deep_link().get_current().ok().flatten().unwrap_or_default();
            // cold-start off the UI thread; the splash shows meanwhile
            std::thread::spawn(move || {
                let window = handle.get_webview_window("main");
                match daemon::ensure_daemon(&base, Duration::from_secs(30)) {
                    Ok(owned) => {
                        *handle.state::<Shell>().owned.lock().expect("shell lock") = owned;
                        if let Some(window) = &window {
                            let view = initial.iter().find_map(|u| parse_deep_link(u.as_str()));
                            navigate(window, &base, view.as_ref());
                        }
                        watch_attention(handle.clone(), base.clone());
                    }
                    Err(error) => {
                        eprintln!("{error}");
                        if let Some(window) = &window {
                            let message = serde_json::to_string(&error.to_string()).unwrap_or_default();
                            let _ = window.eval(&format!(
                                "document.body.innerHTML = '<p style=\"max-width:520px\">' + {message} + '<br><br>Reinstall the app, set AEOS_DAEMON_CMD (e.g. <code>node /path/to/aeosd/dist/main.js</code>), or put <code>aeosd</code> on PATH, then relaunch.</p>'"
                            ));
                        }
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build the AEOS shell");

    // SIGTERM/SIGINT/SIGHUP (logout, `kill`, system shutdown) take the same
    // clean path as closing the window — otherwise an owned daemon is orphaned
    let signal_handle = app.handle().clone();
    let _ = ctrlc::set_handler(move || signal_handle.exit(0));

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            // quit cleanly: stop only the daemon this shell started
            if let Some(owned) = handle.state::<Shell>().owned.lock().ok().and_then(|mut o| o.take()) {
                owned.stop();
            }
        }
    });
}
