//! Linux endpoint names and routing.
//!
//! CPAL only exposes the raw ALSA PCM names on Linux (`default`, `pulse`,
//! `sysdefault:CARD=PCH`, ...). Those names tell a user nothing about which
//! Bluetooth speaker or HDMI display is actually connected. This module asks
//! PipeWire/PulseAudio for the friendly endpoint descriptions and keeps the
//! real sink name for routing, so the picker can show "WH-1000XM5 · Bluetooth ·
//! BlueZ" while still opening the Pulse sink that produces sound.

use std::ffi::OsString;
use std::process::Command;

use serde_json::Value;

/// A sink or source reported by `pactl`. `name` is the backend routing target;
/// `label` is the text the settings UI can display.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoint {
    pub name: String,
    pub label: String,
    pub is_default: bool,
    pub is_bluetooth: bool,
    pub is_hdmi: bool,
    pub is_usb: bool,
}

pub fn outputs() -> Vec<Endpoint> {
    endpoints("sinks", "get-default-sink", "Default Sink:")
}

/// The current sinks and default, used to follow a Bluetooth headset across a
/// disconnect/reconnect. `None` means `pactl` could not be read, which must not
/// be confused with "the machine has no sinks".
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RouteState {
    pub sinks: Vec<Endpoint>,
    pub default_sink: Option<String>,
}

impl RouteState {
    pub fn has_sink(&self, name: &str) -> bool {
        self.sinks
            .iter()
            .any(|endpoint| endpoint.name.eq_ignore_ascii_case(name))
    }

    pub fn default_name(&self) -> Option<&str> {
        self.default_sink
            .as_deref()
            .filter(|name| self.has_sink(name))
    }

    /// The saved sink while it exists, otherwise PipeWire/PulseAudio's default.
    /// BlueZ recreates the sink under a different profile suffix on reconnect
    /// (`bluez_sink.AC_12...a2dp_sink` becomes `bluez_output.AC_12...1`), so a
    /// matching Bluetooth address is treated as the same physical device.
    pub fn target_sink(&self, preferred: Option<&str>) -> Option<String> {
        if let Some(preferred) = preferred {
            if let Some(exact) = self
                .sinks
                .iter()
                .find(|endpoint| endpoint.name.eq_ignore_ascii_case(preferred))
            {
                return Some(exact.name.clone());
            }
            if let Some(address) = bluetooth_address(preferred) {
                if let Some(alias) = self.sinks.iter().find(|endpoint| {
                    endpoint.is_bluetooth
                        && bluetooth_address(&endpoint.name).as_deref() == Some(address.as_str())
                }) {
                    return Some(alias.name.clone());
                }
            }
        }
        self.default_name().map(str::to_string)
    }
}

/// True when the open stream is no longer attached to the sink it should use.
/// `follow_default` is false for a raw ALSA device, which is not a Pulse sink.
pub fn should_reopen(
    preferred_sink: Option<&str>,
    active_sink: Option<&str>,
    follow_default: bool,
    state: &RouteState,
) -> bool {
    if !follow_default && preferred_sink.is_none() {
        return false;
    }
    state
        .target_sink(preferred_sink)
        .is_some_and(|target| active_sink != Some(target.as_str()))
}

/// Reads the current sink list and default in one place. Returning `None` when
/// `pactl` is unavailable keeps a transient utility failure from causing the
/// engine to tear down a working stream.
pub fn route_state() -> Option<RouteState> {
    let raw = pactl(&["-f", "json", "list", "sinks"])?;
    let default = default_endpoint("get-default-sink", "Default Sink:").unwrap_or_default();
    let sinks = parse_endpoints(&raw, &default, "sinks");
    if sinks.is_empty() {
        return None;
    }
    let default_sink = sinks
        .iter()
        .find(|endpoint| endpoint.is_default)
        .map(|endpoint| endpoint.name.clone());
    Some(RouteState {
        sinks,
        default_sink,
    })
}

fn bluetooth_address(name: &str) -> Option<String> {
    name.split('.').find_map(|part| {
        let octets: Vec<&str> = part.split(['_', ':']).collect();
        (octets.len() == 6
            && octets
                .iter()
                .all(|octet| octet.len() == 2 && octet.chars().all(|c| c.is_ascii_hexdigit())))
        .then(|| octets.join(":").to_ascii_lowercase())
    })
}

pub fn inputs() -> Vec<Endpoint> {
    endpoints("sources", "get-default-source", "Default Source:")
}

fn endpoints(kind: &str, default_command: &str, default_key: &str) -> Vec<Endpoint> {
    let Some(raw) = pactl(&["-f", "json", "list", kind]) else {
        return Vec::new();
    };
    let default = default_endpoint(default_command, default_key).unwrap_or_default();
    parse_endpoints(&raw, &default, kind)
}

fn parse_endpoints(raw: &str, default: &str, kind: &str) -> Vec<Endpoint> {
    let Ok(Value::Array(items)) = serde_json::from_str::<Value>(raw) else {
        return Vec::new();
    };

    items
        .into_iter()
        .filter_map(|item| {
            let name = item.get("name")?.as_str()?.trim();
            if name.is_empty() || (kind == "sources" && name.ends_with(".monitor")) {
                return None;
            }
            let description = item
                .get("properties")
                .and_then(|props| props.get("device.description"))
                .and_then(Value::as_str)
                .or_else(|| item.get("description").and_then(Value::as_str))
                .unwrap_or(name)
                .trim();
            let bus = item
                .get("properties")
                .and_then(|props| props.get("device.bus"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_lowercase();
            let icon = item
                .get("properties")
                .and_then(|props| props.get("device.icon_name"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_lowercase();
            let haystack = format!("{name} {description} {bus} {icon}").to_lowercase();
            let is_bluetooth = bus.contains("bluetooth")
                || haystack.contains("bluez")
                || haystack.contains("bluetooth");
            let is_hdmi = haystack.contains("hdmi")
                || haystack.contains("displayport")
                || haystack.contains("display port");
            let is_usb = bus.contains("usb") || haystack.contains("usb");

            Some(Endpoint {
                name: name.to_string(),
                label: endpoint_label(description, name, is_bluetooth, is_hdmi, is_usb),
                is_default: name == default,
                is_bluetooth,
                is_hdmi,
                is_usb,
            })
        })
        .collect()
}

fn endpoint_label(description: &str, name: &str, bluetooth: bool, hdmi: bool, usb: bool) -> String {
    let mut label = if description.trim().is_empty() {
        name.to_string()
    } else {
        description.trim().to_string()
    };
    let lower = label.to_lowercase();

    if bluetooth {
        if !lower.contains("bluetooth") {
            append_tag(&mut label, "Bluetooth");
        }
        if !lower.contains("bluez") {
            append_tag(&mut label, "BlueZ");
        }
    }
    if hdmi {
        if !lower.contains("hdmi") {
            append_tag(&mut label, "HDMI");
        }
        if !lower.contains("screen") {
            append_tag(&mut label, "screen");
        }
    }
    if usb && !lower.contains("usb") {
        append_tag(&mut label, "USB");
    }

    label
}

fn append_tag(label: &mut String, tag: &str) {
    if !label.trim().is_empty() {
        label.push_str(" · ");
    }
    label.push_str(tag);
}

fn pactl(args: &[&str]) -> Option<String> {
    let output = Command::new("pactl").args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8(output.stdout).ok()
}

fn default_endpoint(command: &str, key: &str) -> Option<String> {
    if let Some(value) = pactl(&[command]) {
        let value = value.trim();
        if !value.is_empty() {
            return Some(value.to_string());
        }
    }

    let info = pactl(&["info"])?;
    info.lines().find_map(|line| {
        line.trim()
            .strip_prefix(key)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

/// True only for the sound-server bridge PCMs themselves.
///
/// `is_bridge_name` also accepts `default`/`sysdefault`, which ALSA enumerates
/// on every machine whether or not a bridge is installed. This predicate is the
/// one that can prove a bridge exists, so it guards both the device filter and
/// the startup banner.
pub fn is_server_bridge(name: &str) -> bool {
    let lower = name.trim().to_lowercase();
    lower.contains("pulse") || lower.contains("pipewire")
}

/// True for the generic ALSA bridge names whose only useful label is the
/// current PipeWire/PulseAudio default endpoint.
pub fn is_bridge_name(name: &str) -> bool {
    matches!(
        name.trim().to_lowercase().as_str(),
        "default" | "pulse" | "pipewire" | "sysdefault"
    )
}

/// Caches `/proc/asound/cards` while building one device list.
#[derive(Debug, Default)]
pub struct FriendlyNames {
    cards: Vec<(String, String)>,
}

impl FriendlyNames {
    pub fn new() -> Self {
        let cards = std::fs::read_to_string("/proc/asound/cards")
            .map(|text| text.lines().filter_map(parse_card_line).collect())
            .unwrap_or_default();
        Self { cards }
    }

    /// A readable name for a raw CPAL device. `default_label` is the friendly
    /// PipeWire/PulseAudio default endpoint, if one was discovered.
    pub fn label(&self, raw: &str, default_label: Option<&str>) -> String {
        if is_bridge_name(raw) {
            return default_label
                .filter(|label| !label.trim().is_empty())
                .unwrap_or("System default")
                .to_string();
        }

        let lower = raw.to_lowercase();
        let mut label = card_id(raw)
            .and_then(|id| {
                self.cards
                    .iter()
                    .find(|(card, _)| card.eq_ignore_ascii_case(id))
                    .map(|(_, name)| name.clone())
            })
            .unwrap_or_else(|| pretty_raw(raw));

        let is_display = lower.contains("hdmi")
            || lower.contains("displayport")
            || lower.contains("display port");
        if is_display {
            if !label.to_lowercase().contains("hdmi") {
                label = format!("HDMI · {label}");
            }
            if !label.to_lowercase().contains("screen") {
                append_tag(&mut label, "screen");
            }
        }
        if lower.contains("usb") && !label.to_lowercase().contains("usb") {
            append_tag(&mut label, "USB");
        }
        if lower.contains("bluez") || lower.contains("bluetooth") {
            let label_lower = label.to_lowercase();
            if !label_lower.contains("bluetooth") {
                append_tag(&mut label, "Bluetooth");
            }
            if !label_lower.contains("bluez") {
                append_tag(&mut label, "BlueZ");
            }
        }

        if label.trim().is_empty() {
            raw.to_string()
        } else {
            label
        }
    }
}

fn card_id(raw: &str) -> Option<&str> {
    let start = raw.find("CARD=")? + "CARD=".len();
    let rest = &raw[start..];
    let end = rest
        .find(|ch: char| ch == ',' || ch == ' ' || ch == ':')
        .unwrap_or(rest.len());
    let id = rest[..end].trim();
    (!id.is_empty()).then_some(id)
}

fn pretty_raw(raw: &str) -> String {
    let mut value = raw.to_string();
    for prefix in [
        "sysdefault:",
        "plughw:",
        "hw:",
        "front:",
        "surround21:",
        "surround40:",
        "surround51:",
        "surround71:",
        "dmix:",
    ] {
        if let Some(rest) = value.strip_prefix(prefix) {
            value = rest.to_string();
            break;
        }
    }
    value = value
        .replace("CARD=", "")
        .replace("DEV=", " ")
        .replace(',', " ");
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn parse_card_line(line: &str) -> Option<(String, String)> {
    let open = line.find('[')?;
    let close = open + 1 + line[open + 1..].find(']')?;
    let id = line[open + 1..close].trim().to_string();
    let rest = line[close + 1..].trim_start_matches(':').trim();
    let (_, name) = rest.split_once(" - ")?;
    let name = name.split(" at ").next().unwrap_or(name).trim().to_string();
    (!id.is_empty() && !name.is_empty()).then_some((id, name))
}

/// Applies `PULSE_SINK`/`PIPEWIRE_NODE` only while a session is being opened,
/// then restores the environment so later streams are not pinned to a sink the
/// user has since changed.
pub struct SinkRoute {
    pulse: Option<OsString>,
    pipewire: Option<OsString>,
}

pub fn route_sink(sink: Option<&str>) -> SinkRoute {
    let pulse = std::env::var_os("PULSE_SINK");
    let pipewire = std::env::var_os("PIPEWIRE_NODE");
    if let Some(sink) = sink.filter(|sink| !sink.trim().is_empty()) {
        std::env::set_var("PULSE_SINK", sink);
        std::env::set_var("PIPEWIRE_NODE", sink);
    }
    SinkRoute { pulse, pipewire }
}

impl Drop for SinkRoute {
    fn drop(&mut self) {
        restore("PULSE_SINK", self.pulse.take());
        restore("PIPEWIRE_NODE", self.pipewire.take());
    }
}

fn restore(key: &str, value: Option<OsString>) {
    match value {
        Some(value) => std::env::set_var(key, value),
        None => std::env::remove_var(key),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bluetooth_sinks_keep_the_protocol_names_in_the_label() {
        let json = r#"[
            {
                "name": "bluez_sink.AC_12_2F_00_11_22.a2dp_sink",
                "description": "WH-1000XM5",
                "properties": {
                    "device.bus": "bluetooth",
                    "device.icon_name": "audio-card-bluetooth"
                }
            }
        ]"#;
        let list = parse_endpoints(json, "bluez_sink.AC_12_2F_00_11_22.a2dp_sink", "sinks");
        assert_eq!(list.len(), 1);
        assert!(list[0].is_default);
        assert!(list[0].is_bluetooth);
        assert!(list[0].label.contains("Bluetooth"));
        assert!(list[0].label.contains("BlueZ"));
    }

    #[test]
    fn hdmi_descriptions_become_screen_outputs() {
        let json = r#"[
            {
                "name": "alsa_output.pci-0000_00_1f.3.hdmi-stereo",
                "description": "HDMI / DisplayPort",
                "properties": { "device.bus": "pci" }
            }
        ]"#;
        let list = parse_endpoints(json, "", "sinks");
        assert!(list[0].is_hdmi);
        assert!(list[0].label.to_lowercase().contains("screen"));
        assert_eq!(list[0].label.matches("HDMI").count(), 1);
    }

    #[test]
    fn monitor_sources_are_not_offered_as_microphones() {
        let json = r#"[
            { "name": "alsa_output.speakers.monitor", "description": "Monitor of Speakers" },
            { "name": "alsa_input.usb-microphone", "description": "USB Microphone" }
        ]"#;
        let list = parse_endpoints(json, "alsa_input.usb-microphone", "sources");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "alsa_input.usb-microphone");
        assert!(list[0].is_usb);
    }

    #[test]
    fn only_real_bridge_pcms_count_as_a_bridge() {
        assert!(is_server_bridge("pulse"));
        assert!(is_server_bridge("pipewire"));
        assert!(is_server_bridge("  PipeWire  "));
        // ALSA always lists these, so they prove nothing.
        assert!(!is_server_bridge("default"));
        assert!(!is_server_bridge("sysdefault"));
        assert!(!is_server_bridge("hw:CARD=PCH,DEV=0"));
    }

    #[test]
    fn generic_bridges_follow_the_default_endpoint_label() {
        let names = FriendlyNames::default();
        assert_eq!(
            names.label("default", Some("Living Room · Bluetooth · BlueZ")),
            "Living Room · Bluetooth · BlueZ"
        );
        assert_eq!(names.label("pulse", None), "System default");
    }

    #[test]
    fn alsa_card_names_are_read_from_proc_style_lines() {
        assert_eq!(
            parse_card_line(" 0 [PCH            ]: HDA-Intel - HDA Intel PCH at 0x123 irq 42"),
            Some(("PCH".into(), "HDA Intel PCH".into()))
        );
        assert_eq!(
            parse_card_line(" 1 [HDMI           ]: HDA-Intel - HDA Intel HDMI at 0x456"),
            Some(("HDMI".into(), "HDA Intel HDMI".into()))
        );
    }

    #[test]
    fn a_hdmi_card_gets_a_screen_tag_without_losing_its_name() {
        let names = FriendlyNames {
            cards: vec![("HDMI".into(), "HDA Intel HDMI".into())],
        };
        let label = names.label("hdmi:CARD=HDMI,DEV=0", None);
        assert!(label.contains("HDA Intel HDMI"));
        assert!(label.to_lowercase().contains("screen"));
    }

    fn endpoint(name: &str, default: bool, bluetooth: bool) -> Endpoint {
        Endpoint {
            name: name.into(),
            label: name.into(),
            is_default: default,
            is_bluetooth: bluetooth,
            is_hdmi: false,
            is_usb: false,
        }
    }

    #[test]
    fn a_bluez_sink_reconnect_with_a_new_profile_is_the_same_device() {
        let state = RouteState {
            sinks: vec![
                endpoint("alsa_output.pci.speakers", true, false),
                endpoint("bluez_output.AC_12_2F_00_11_22.1", false, true),
            ],
            default_sink: Some("alsa_output.pci.speakers".into()),
        };
        let old = "bluez_sink.AC_12_2F_00_11_22.a2dp_sink";
        assert_eq!(
            state.target_sink(Some(old)).as_deref(),
            Some("bluez_output.AC_12_2F_00_11_22.1")
        );
        assert!(should_reopen(
            Some(old),
            Some("alsa_output.pci.speakers"),
            true,
            &state
        ));
    }

    #[test]
    fn a_missing_saved_sink_does_not_flap_while_the_default_is_stable() {
        let state = RouteState {
            sinks: vec![endpoint("alsa_output.pci.speakers", true, false)],
            default_sink: Some("alsa_output.pci.speakers".into()),
        };
        assert_eq!(
            state
                .target_sink(Some("bluez_sink.GONE.a2dp_sink"))
                .as_deref(),
            Some("alsa_output.pci.speakers")
        );
        assert!(!should_reopen(
            Some("bluez_sink.GONE.a2dp_sink"),
            Some("alsa_output.pci.speakers"),
            true,
            &state
        ));
    }

    #[test]
    fn a_returning_saved_sink_reopens_the_stream() {
        let state = RouteState {
            sinks: vec![
                endpoint("alsa_output.pci.speakers", true, false),
                endpoint("bluez_sink.AC_12_2F_00_11_22.a2dp_sink", false, true),
            ],
            default_sink: Some("alsa_output.pci.speakers".into()),
        };
        assert!(should_reopen(
            Some("bluez_sink.AC_12_2F_00_11_22.a2dp_sink"),
            Some("alsa_output.pci.speakers"),
            true,
            &state
        ));
    }

    #[test]
    fn system_default_changes_are_followed_but_raw_devices_are_not() {
        let speakers = RouteState {
            sinks: vec![endpoint("alsa_output.pci.speakers", true, false)],
            default_sink: Some("alsa_output.pci.speakers".into()),
        };
        assert!(!should_reopen(
            None,
            Some("alsa_output.pci.speakers"),
            true,
            &speakers
        ));

        let headphones = RouteState {
            sinks: vec![
                endpoint("alsa_output.pci.speakers", false, false),
                endpoint("bluez_output.AC_12_2F_00_11_22.1", true, true),
            ],
            default_sink: Some("bluez_output.AC_12_2F_00_11_22.1".into()),
        };
        assert!(should_reopen(
            None,
            Some("alsa_output.pci.speakers"),
            true,
            &headphones
        ));
        assert!(!should_reopen(
            None,
            Some("alsa_output.pci.speakers"),
            false,
            &headphones
        ));
    }
}
