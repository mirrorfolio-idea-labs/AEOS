//! Per-platform webview fixes applied before the first window exists.
//!
//! Linux: WebKitGTK >= 2.42 renders through DMA-BUF. On the proprietary
//! NVIDIA driver that path yields a blank (white or grey) window. Rolling
//! distros such as Arch hit this first because they ship the newest WebKitGTK.
//! Turning the DMA-BUF renderer off only on NVIDIA avoids that and leaves
//! every other GPU on the fast path. A value the user already set always wins.

/// Whether to set `WEBKIT_DISABLE_DMABUF_RENDERER=1`.
pub fn wants_dmabuf_workaround(already_set: bool, nvidia_driver: bool) -> bool {
    !already_set && nvidia_driver
}

/// Call once at startup, before any thread or webview is created.
pub fn apply_webview_workarounds() {
    #[cfg(target_os = "linux")]
    {
        const VAR: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";
        let nvidia = std::path::Path::new("/proc/driver/nvidia/version").exists();
        if wants_dmabuf_workaround(std::env::var_os(VAR).is_some(), nvidia) {
            std::env::set_var(VAR, "1");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::wants_dmabuf_workaround;

    #[test]
    fn only_on_nvidia_and_never_over_a_user_choice() {
        assert!(wants_dmabuf_workaround(false, true));
        assert!(!wants_dmabuf_workaround(false, false));
        assert!(!wants_dmabuf_workaround(true, true));
        assert!(!wants_dmabuf_workaround(true, false));
    }
}
