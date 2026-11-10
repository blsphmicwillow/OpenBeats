//! Discord webhook payload for the "Suggestions & Fixes" box.
//!
//! The payload is built and validated here so it can be tested without sending
//! anything: message limits, the @here ping and the metadata fields.

use serde_json::{json, Value};

/// Endpoint the desktop build posts suggestions to.
pub const WEBHOOK_URL: &str = "https://discord.com/api/webhooks/1569624931161874534/l2Rf8zkRKO-sgPYrEgzZqfk3EBT80gIqvp1I7-VzMhqO6n8e979Dnr8h2g5nPWVPZ5mj";

pub const MIN_LEN: usize = 4;
pub const MAX_LEN: usize = 1_800;

/// Trims the message and rejects empty or oversized submissions.
pub fn clean_message(message: &str) -> Result<String, String> {
    let trimmed = message.trim();
    if trimmed.chars().count() < MIN_LEN {
        return Err("please write a little more so the report is useful".into());
    }
    if trimmed.chars().count() > MAX_LEN {
        return Err(format!("keep it under {MAX_LEN} characters"));
    }
    // Strip control characters that would break the embed formatting.
    let cleaned: String = trimmed
        .chars()
        .map(|c| if c.is_control() && c != '\n' { ' ' } else { c })
        .collect();
    Ok(cleaned)
}

/// Builds the JSON body posted to the webhook.
pub fn payload(message: &str, os: &str, version: &str) -> Result<Value, String> {
    let message = clean_message(message)?;
    Ok(json!({
        "username": "OpenBeats",
        "content": format!("@here **Suggestion / fix** · OpenBeats {version} on {os}"),
        "allowed_mentions": { "parse": ["everyone"] },
        "embeds": [{
            "title": "Suggestion & Fixes",
            "description": message,
            "color": 0xE8A33D,
            "fields": [
                { "name": "OS", "value": os, "inline": true },
                { "name": "App version", "value": version, "inline": true }
            ]
        }]
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_carries_the_message_metadata_and_ping() {
        let value = payload("Please add a reverb freeze control", "linux", "1.0.1").unwrap();
        assert_eq!(
            value["content"],
            "@here **Suggestion / fix** · OpenBeats 1.0.1 on linux"
        );
        assert_eq!(
            value["embeds"][0]["description"],
            "Please add a reverb freeze control"
        );
        assert_eq!(value["embeds"][0]["fields"][0]["value"], "linux");
        assert_eq!(value["embeds"][0]["fields"][1]["value"], "1.0.1");
        assert_eq!(value["allowed_mentions"]["parse"][0], "everyone");
    }

    #[test]
    fn short_and_empty_messages_are_rejected() {
        assert!(payload("", "linux", "1.0.1").is_err());
        assert!(payload("  ok ", "linux", "1.0.1").is_err());
        assert!(payload(&"a".repeat(MAX_LEN + 1), "linux", "1.0.1").is_err());
    }

    #[test]
    fn control_characters_are_scrubbed() {
        let cleaned = clean_message("hello\u{0007} there").unwrap();
        assert!(!cleaned.contains('\u{0007}'));
        assert!(cleaned.contains("hello"));
    }

    #[test]
    fn the_endpoint_is_a_discord_webhook() {
        assert!(WEBHOOK_URL.starts_with("https://discord.com/api/webhooks/"));
    }
}
