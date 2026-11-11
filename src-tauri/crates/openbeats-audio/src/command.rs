//! Local natural-language command parser.
//!
//! Maps phrases like "add reverb to snare" onto internal actions. Everything is
//! table-driven and local: no model, no network, no cloud.

use serde::{Deserialize, Serialize};

/// The action a phrase maps to.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ParsedCommand {
    /// Machine action, e.g. `add_effect`, `mute_channel`, `set_tempo`.
    pub action: String,
    /// Effect, preset or channel the action applies to.
    pub target: Option<String>,
    /// Numeric argument (tempo, gain, ...).
    pub value: Option<f32>,
    /// 0..1 — how much of the phrase matched.
    pub confidence: f32,
    /// The original phrase.
    pub raw: String,
}

const EFFECTS: [(&str, &str); 13] = [
    ("eq", "eq3"),
    ("equaliser", "eq3"),
    ("equalizer", "eq3"),
    ("compressor", "comp"),
    ("compress", "comp"),
    ("limiter", "limiter"),
    ("reverb", "reverb"),
    ("delay", "delay"),
    ("bitcrush", "bitcrush"),
    ("tremolo", "tremolo"),
    ("auto pan", "autopan"),
    ("autopan", "autopan"),
    ("ring mod", "ringmod"),
];

const ALIASES: [(&str, &str); 5] = [
    ("vocals", "vox"),
    ("vocal", "vox"),
    ("hihat", "hat"),
    ("hi-hat", "hat"),
    ("open hat", "openhat"),
];

fn normalize(text: &str) -> String {
    // Quotes and trailing punctuation are dropped so "Stop." reads as "stop".
    let cleaned: String = text
        .to_lowercase()
        .chars()
        .map(|c| match c {
            '“' | '”' | '"' | '\'' | '.' | ',' | '!' | '?' => ' ',
            other => other,
        })
        .collect();
    cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Parses a phrase. Returns `None` when nothing recognisable is present.
pub fn parse_command(text: &str) -> Option<ParsedCommand> {
    let raw = text.trim().to_string();
    if raw.is_empty() {
        return None;
    }
    let phrase = normalize(&raw);

    // "set tempo to 140" / "bpm 140" / "140 bpm"
    if phrase.contains("tempo") || phrase.contains("bpm") {
        if let Some(value) = first_number(&phrase) {
            if (20.0..=400.0).contains(&value) {
                return Some(quick("set_tempo", None, Some(value), 0.95, &raw));
            }
        }
    }

    // "add reverb to snare"
    if let Some((word, effect)) = EFFECTS.iter().find(|(word, _)| phrase.contains(word)) {
        let channel = channel_after(&phrase, " to ")
            .or_else(|| channel_before(&phrase, word))
            .and_then(|name| canonical(Some(name)));
        let target = match channel {
            Some(channel) => format!("{channel}:{effect}"),
            None => (*effect).to_string(),
        };
        return Some(quick("add_effect", Some(target), None, 0.9, &raw));
    }

    if phrase.starts_with("mute") || phrase.starts_with("unmute") {
        let unmute = phrase.starts_with("unmute");
        let target = channel_after(&phrase, "unmute ").or_else(|| channel_after(&phrase, "mute "));
        if let Some(channel) = target {
            return Some(quick(
                if unmute {
                    "unmute_channel"
                } else {
                    "mute_channel"
                },
                Some(channel),
                None,
                0.92,
                &raw,
            ));
        }
    }

    if phrase.starts_with("solo") || phrase.starts_with("unsolo") {
        let unsolo = phrase.starts_with("unsolo");
        let target = channel_after(&phrase, "unsolo ").or_else(|| channel_after(&phrase, "solo "));
        if let Some(channel) = target {
            return Some(quick(
                if unsolo {
                    "unsolo_channel"
                } else {
                    "solo_channel"
                },
                Some(channel),
                None,
                0.9,
                &raw,
            ));
        }
    }

    if phrase == "play" || phrase == "start" || phrase == "roll" {
        return Some(quick("play", None, None, 1.0, &raw));
    }
    if phrase == "stop" || phrase == "pause" {
        return Some(quick("stop", None, None, 1.0, &raw));
    }
    if phrase.starts_with("undo") {
        return Some(quick("undo", None, None, 0.9, &raw));
    }
    if phrase.starts_with("redo") {
        return Some(quick("redo", None, None, 0.9, &raw));
    }
    if phrase.contains("mixer") {
        return Some(quick("show_mixer", None, None, 0.85, &raw));
    }
    if phrase.contains("piano roll") {
        return Some(quick("show_piano_roll", None, None, 0.85, &raw));
    }
    if phrase.contains("playlist") {
        return Some(quick("show_playlist", None, None, 0.85, &raw));
    }
    if phrase.contains("new pattern") || phrase.starts_with("add pattern") {
        return Some(quick("new_pattern", None, None, 0.9, &raw));
    }
    if phrase.contains("bounce") || phrase.contains("export") {
        return Some(quick("export_wav", None, None, 0.8, &raw));
    }

    // "add bass" / "add a kick channel"
    if phrase.starts_with("add ") || phrase.starts_with("create ") {
        let preset = [
            "kick", "snare", "hat", "openhat", "clap", "tom", "rim", "bass", "sub", "fmbass",
            "lead", "keys", "glass", "choir", "chords", "pluck", "pad", "anvil", "prism",
            "sundial", "cordwood", "vector9", "acidwell", "dice", "dustdevil", "chatter",
            "hammerfelt",
        ]
        .iter()
        .find(|p| phrase.contains(**p));
        if let Some(preset) = preset {
            return Some(quick(
                "add_channel",
                Some((*preset).to_string()),
                None,
                0.88,
                &raw,
            ));
        }
    }

    None
}

fn quick(
    action: &str,
    target: Option<String>,
    value: Option<f32>,
    confidence: f32,
    raw: &str,
) -> ParsedCommand {
    ParsedCommand {
        action: action.to_string(),
        target: canonical(target),
        value,
        confidence,
        raw: raw.to_string(),
    }
}

fn canonical(target: Option<String>) -> Option<String> {
    let target = target?;
    let lower = target.trim().to_string();
    Some(
        ALIASES
            .iter()
            .find(|(alias, _)| *alias == lower)
            .map(|(_, canonical)| (*canonical).to_string())
            .unwrap_or(lower),
    )
}

fn channel_after(phrase: &str, marker: &str) -> Option<String> {
    let rest = phrase.split(marker).nth(1)?.trim();
    let word = rest.split_whitespace().next()?;
    Some(word.trim_end_matches(['.', ',']).to_string())
}

fn channel_before(phrase: &str, marker: &str) -> Option<String> {
    let before = phrase.split(marker).next()?.trim();
    let word = before.split_whitespace().last()?;
    if word == "add" || word == "a" || word == "the" {
        None
    } else {
        Some(word.to_string())
    }
}

fn first_number(text: &str) -> Option<f32> {
    text.split_whitespace().find_map(|word| {
        word.trim_matches(|c: char| !c.is_ascii_digit() && c != '.')
            .parse::<f32>()
            .ok()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_the_example_from_the_brief() {
        let cmd = parse_command("add reverb to snare").expect("parsed");
        assert_eq!(cmd.action, "add_effect");
        assert_eq!(cmd.target.as_deref(), Some("snare:reverb"));
        assert!(cmd.confidence > 0.8);
    }

    #[test]
    fn sets_tempo_from_a_number() {
        let cmd = parse_command("set tempo to 140").expect("parsed");
        assert_eq!(cmd.action, "set_tempo");
        assert_eq!(cmd.value, Some(140.0));
    }

    #[test]
    fn mutes_and_unmutes_channels() {
        assert_eq!(parse_command("mute bass").unwrap().action, "mute_channel");
        assert_eq!(
            parse_command("unmute bass").unwrap().action,
            "unmute_channel"
        );
        assert_eq!(
            parse_command("solo kick").unwrap().target.as_deref(),
            Some("kick")
        );
    }

    #[test]
    fn resolves_aliases() {
        let cmd = parse_command("add delay to vocals").unwrap();
        assert_eq!(cmd.target.as_deref(), Some("vox:delay"));
    }

    #[test]
    fn transport_and_view_commands() {
        assert_eq!(parse_command("play").unwrap().action, "play");
        assert_eq!(parse_command("Stop.").unwrap().action, "stop");
        assert_eq!(
            parse_command("open the mixer").unwrap().action,
            "show_mixer"
        );
        assert_eq!(parse_command("bounce song").unwrap().action, "export_wav");
    }

    #[test]
    fn adds_channels_by_preset() {
        let cmd = parse_command("add a pluck channel").unwrap();
        assert_eq!(cmd.action, "add_channel");
        assert_eq!(cmd.target.as_deref(), Some("pluck"));
    }

    #[test]
    fn unknown_phrases_return_none() {
        assert!(parse_command("").is_none());
        assert!(parse_command("make it sound better").is_none());
        assert!(parse_command("what is the weather").is_none());
    }

    #[test]
    fn rejects_impossible_tempos() {
        assert!(parse_command("tempo 900").is_none());
    }
}
