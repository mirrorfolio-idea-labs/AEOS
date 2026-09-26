//! Pure mapping logic (unit-tested): deep links and daemon events → ADE URLs.
//! The shell forks no UI logic — every destination is an ADE query string.

use serde::Deserialize;

/// Where the ADE should open: `?agent=<ws>/<agent>&tab=<tab>`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct View {
    pub workspace_id: String,
    pub agent_id: String,
    pub tab: Option<String>,
}

const TABS: [&str; 5] = ["objective", "approvals", "review", "files", "terminal"];

fn is_slug(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// `aeos://agent/<workspace>/<agent>[/<tab>]` → a view; anything else → `None`
/// (unknown links open the ADE home instead of being trusted).
pub fn parse_deep_link(url: &str) -> Option<View> {
    let rest = url.strip_prefix("aeos://")?;
    let rest = rest.split(['?', '#']).next().unwrap_or("");
    let parts: Vec<&str> = rest.trim_end_matches('/').split('/').collect();
    match parts.as_slice() {
        ["agent", ws, agent] if is_slug(ws) && is_slug(agent) => Some(View {
            workspace_id: (*ws).to_string(),
            agent_id: (*agent).to_string(),
            tab: None,
        }),
        ["agent", ws, agent, tab] if is_slug(ws) && is_slug(agent) && TABS.contains(tab) => Some(View {
            workspace_id: (*ws).to_string(),
            agent_id: (*agent).to_string(),
            tab: Some((*tab).to_string()),
        }),
        _ => None,
    }
}

/// ADE URL for a view on the daemon at `base` (e.g. `http://127.0.0.1:7777`).
pub fn view_url(base: &str, view: Option<&View>) -> String {
    let base = base.trim_end_matches('/');
    match view {
        None => format!("{base}/"),
        Some(v) => {
            let mut url = format!("{base}/?agent={}/{}", v.workspace_id, v.agent_id);
            if let Some(tab) = &v.tab {
                url.push_str("&tab=");
                url.push_str(tab);
            }
            url
        }
    }
}

#[derive(Debug, Deserialize)]
struct StatusPayload {
    #[serde(rename = "workspaceId")]
    workspace_id: String,
    status: String,
    reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct StatusEvent {
    #[serde(rename = "type")]
    kind: String,
    #[serde(rename = "agentId")]
    agent_id: Option<String>,
    payload: StatusPayload,
}

/// A native notification to raise, and where clicking it goes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Alert {
    pub title: String,
    pub body: String,
    pub view: View,
}

/// One SSE `data:` line → an alert when an agent becomes blocked or done.
/// Blocked → the approvals tab (that is what a human must act on).
pub fn alert_for_event(data: &str) -> Option<Alert> {
    let event: StatusEvent = serde_json::from_str(data).ok()?;
    if event.kind != "agent.status_changed" {
        return None;
    }
    let agent = event.agent_id?;
    let (title, tab) = match event.payload.status.as_str() {
        "blocked" => (format!("{agent} needs you"), Some("approvals".to_string())),
        "done" => (format!("{agent} finished"), None),
        _ => return None,
    };
    Some(Alert {
        title,
        body: event.payload.reason.unwrap_or_default(),
        view: View { workspace_id: event.payload.workspace_id, agent_id: agent, tab },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deep_links_map_to_views_and_reject_junk() {
        assert_eq!(
            parse_deep_link("aeos://agent/acme/backend-dev/approvals"),
            Some(View { workspace_id: "acme".into(), agent_id: "backend-dev".into(), tab: Some("approvals".into()) })
        );
        assert_eq!(
            parse_deep_link("aeos://agent/acme/backend-dev/"),
            Some(View { workspace_id: "acme".into(), agent_id: "backend-dev".into(), tab: None })
        );
        assert_eq!(parse_deep_link("aeos://agent/acme/backend-dev/evil"), None);
        assert_eq!(parse_deep_link("aeos://agent/../x"), None);
        assert_eq!(parse_deep_link("aeos://agent/ACME/x"), None);
        assert_eq!(parse_deep_link("https://example.com"), None);
    }

    #[test]
    fn view_urls_are_ade_query_strings() {
        let v = parse_deep_link("aeos://agent/acme/dev/approvals").unwrap();
        assert_eq!(view_url("http://127.0.0.1:7777/", Some(&v)), "http://127.0.0.1:7777/?agent=acme/dev&tab=approvals");
        assert_eq!(view_url("http://127.0.0.1:7777", None), "http://127.0.0.1:7777/");
    }

    #[test]
    fn accept_approval_notification_opens_the_inbox_view() {
        let data = r#"{"v":1,"id":"01JZX6YV1T9GN0WT5V40000K0A","ts":"2026-07-13T10:00:18.000Z","source":"daemon","agentId":"dev","type":"agent.status_changed","payload":{"workspaceId":"acme","status":"blocked","previous":"working","seq":3,"via":"events","reason":"approval requested: git_push"}}"#;
        let alert = alert_for_event(data).expect("blocked raises an alert");
        assert_eq!(alert.title, "dev needs you");
        assert_eq!(alert.body, "approval requested: git_push");
        assert_eq!(view_url("http://127.0.0.1:7777", Some(&alert.view)), "http://127.0.0.1:7777/?agent=acme/dev&tab=approvals");
    }

    #[test]
    fn only_blocked_and_done_alert() {
        let working = r#"{"type":"agent.status_changed","agentId":"dev","payload":{"workspaceId":"acme","status":"working"}}"#;
        assert_eq!(alert_for_event(working), None);
        let done = r#"{"type":"agent.status_changed","agentId":"dev","payload":{"workspaceId":"acme","status":"done"}}"#;
        assert_eq!(alert_for_event(done).unwrap().view.tab, None);
        assert_eq!(alert_for_event("not json"), None);
    }
}
