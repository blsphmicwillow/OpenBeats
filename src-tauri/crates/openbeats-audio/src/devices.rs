//! Output-device preference logic, kept free of CPAL so it is testable.
//!
//! The Linux silent-audio problem is usually a device choice, not a DSP bug:
//! ALSA's `default` PCM can point at a null sink while the PulseAudio/PipeWire
//! bridge is a separate device. This module decides which enumerated device to
//! open, given what the user asked for and what the host offered.

/// One enumerated output device.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Candidate {
    pub name: String,
    pub is_default: bool,
}

/// Name fragments that identify the PulseAudio/PipeWire ALSA plugin.
const PULSE_HINTS: [&str; 3] = ["pipewire", "pulse", "pulseaudio"];

fn is_pulse_bridge(name: &str) -> bool {
    let lower = name.to_lowercase();
    PULSE_HINTS.iter().any(|hint| lower.contains(hint))
}

/// Chooses the index of the device to open.
///
/// Order: the requested device (exact name first, then a containing match), then
/// on Linux the PipeWire/Pulse bridge, then the system default, then the first
/// device. Returns `None` only when nothing was enumerated.
pub fn pick(
    candidates: &[Candidate],
    requested: Option<&str>,
    prefer_pulse: bool,
) -> Option<usize> {
    if candidates.is_empty() {
        return None;
    }
    if let Some(want) = requested.map(str::trim).filter(|want| !want.is_empty()) {
        if let Some(index) = candidates
            .iter()
            .position(|c| c.name.eq_ignore_ascii_case(want))
        {
            return Some(index);
        }
        let lower = want.to_lowercase();
        if let Some(index) = candidates
            .iter()
            .position(|c| c.name.to_lowercase().contains(&lower))
        {
            return Some(index);
        }
    }
    if prefer_pulse {
        // Prefer PipeWire over PulseAudio when both are present.
        if let Some(index) = candidates
            .iter()
            .position(|c| c.name.to_lowercase().contains("pipewire"))
        {
            return Some(index);
        }
        if let Some(index) = candidates.iter().position(|c| is_pulse_bridge(&c.name)) {
            return Some(index);
        }
    }
    candidates.iter().position(|c| c.is_default).or(Some(0))
}

/// Separates the CPAL host name from the device name in a stable device id.
const DEVICE_ID_SEPARATOR: char = '|';

/// Builds the id the UI sends back when it wants a specific device opened.
///
/// The host is part of the id so Windows can open a WASAPI or ASIO device
/// explicitly, macOS can stay on CoreAudio, and Linux can target ALSA/JACK
/// without guessing from a display name that may be duplicated.
pub fn device_id(host: &str, name: &str) -> String {
    format!("{host}{DEVICE_ID_SEPARATOR}{name}")
}

/// Splits a device id into its optional host and its device name. Ids without a
/// separator are treated as plain names for backwards compatibility.
pub fn split_device_id(id: &str) -> (Option<&str>, &str) {
    match id.split_once(DEVICE_ID_SEPARATOR) {
        Some((host, name)) if !host.is_empty() && !name.is_empty() => (Some(host), name),
        _ => (None, id),
    }
}

/// The routing target encoded in a synthetic PipeWire/Pulse output id.
/// `PulseAudio|sink:alsa_output.pci-...` becomes `Some("alsa_output.pci-...")`.
pub fn requested_sink(id: &str) -> Option<&str> {
    let (_, name) = split_device_id(id);
    name.strip_prefix("sink:").filter(|sink| !sink.is_empty())
}

/// The raw CPAL device name encoded in an id. Synthetic sink ids return `None`
/// because they are routed by the sink environment, not by an ALSA PCM name.
pub fn requested_device_name(id: &str) -> Option<&str> {
    let (_, name) = split_device_id(id);
    (!name.is_empty() && !name.starts_with("sink:")).then_some(name)
}

/// True when the stream should be reopened because the saved physical device
/// vanished or returned, or because the OS default changed. Unlike the Linux
/// PipeWire watcher, this uses CPAL's own device list and works on every host.
///
/// A device that is still absent while the stream is already on the fallback is
/// left alone; otherwise the engine would rebuild every check forever.
pub fn should_follow_device(
    requested: Option<&str>,
    active: Option<&str>,
    default: Option<&str>,
    available: &[String],
) -> bool {
    if let Some(want) = requested {
        let present = available.iter().any(|name| name.eq_ignore_ascii_case(want));
        if present {
            return !active.is_some_and(|active| active.eq_ignore_ascii_case(want));
        }
        return active.is_some_and(|active| active.eq_ignore_ascii_case(want));
    }
    default.is_some_and(|default| active != Some(default))
}

/// One input or output device, as serialized to the settings UI.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct DeviceInfo {
    pub id: String,
    pub friendly_name: String,
    pub is_default: bool,
}

/// The unified device list returned by `get_audio_devices`.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct AudioDevices {
    pub inputs: Vec<DeviceInfo>,
    pub outputs: Vec<DeviceInfo>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(name: &str, is_default: bool) -> Candidate {
        Candidate {
            name: name.into(),
            is_default,
        }
    }

    #[test]
    fn a_requested_device_wins() {
        let devices = [candidate("Speakers", true), candidate("USB Headset", false)];
        assert_eq!(pick(&devices, Some("USB Headset"), true), Some(1));
        assert_eq!(pick(&devices, Some("usb headset"), true), Some(1));
    }

    #[test]
    fn a_partial_name_still_matches() {
        let devices = [
            candidate("Built-in Audio Analog Stereo", true),
            candidate("Scarlett 2i2 USB", false),
        ];
        assert_eq!(pick(&devices, Some("Scarlett"), false), Some(1));
    }

    #[test]
    fn an_unknown_request_falls_back_instead_of_failing() {
        let devices = [candidate("Speakers", true)];
        assert_eq!(pick(&devices, Some("Gone Device"), true), Some(0));
    }

    #[test]
    fn the_pulse_bridge_beats_a_generic_alsa_default_on_linux() {
        let devices = [
            candidate("default", true),
            candidate("pulse", false),
            candidate("sysdefault:CARD=PCH", false),
        ];
        assert_eq!(pick(&devices, None, true), Some(1));
    }

    #[test]
    fn pipewire_beats_pulse_when_both_are_listed() {
        let devices = [
            candidate("default", true),
            candidate("pulse", false),
            candidate("pipewire", false),
        ];
        assert_eq!(pick(&devices, None, true), Some(2));
    }

    #[test]
    fn without_the_linux_preference_the_system_default_is_used() {
        let devices = [candidate("default", true), candidate("pulse", false)];
        assert_eq!(pick(&devices, None, false), Some(0));
    }

    #[test]
    fn an_empty_device_list_has_no_choice() {
        assert_eq!(pick(&[], Some("anything"), true), None);
    }

    #[test]
    fn device_ids_round_trip_the_host_and_name() {
        let id = device_id("WASAPI", "Microphone (USB Audio)");
        assert_eq!(id, "WASAPI|Microphone (USB Audio)");
        assert_eq!(
            split_device_id(&id),
            (Some("WASAPI"), "Microphone (USB Audio)")
        );
    }

    #[test]
    fn legacy_plain_device_names_still_work() {
        assert_eq!(split_device_id("Speakers"), (None, "Speakers"));
        assert_eq!(split_device_id("|Speakers"), (None, "|Speakers"));
    }

    #[test]
    fn synthetic_sink_ids_keep_the_sink_name_for_routing() {
        let id = device_id("PulseAudio", "sink:bluez_sink.AC_12");
        assert_eq!(requested_sink(&id), Some("bluez_sink.AC_12"));
        assert_eq!(requested_device_name(&id), None);
        assert_eq!(requested_sink("pulse"), None);
        assert_eq!(requested_device_name("pulse"), Some("pulse"));
    }

    #[test]
    fn a_physical_saved_device_is_followed_across_a_reconnect() {
        let speakers = vec!["Speakers".to_string(), "USB Headset".to_string()];
        assert!(!should_follow_device(
            Some("USB Headset"),
            Some("USB Headset"),
            Some("Speakers"),
            &speakers
        ));
        assert!(!should_follow_device(
            Some("USB Headset"),
            Some("Speakers"),
            Some("Speakers"),
            &["Speakers".to_string()]
        ));
        assert!(should_follow_device(
            Some("USB Headset"),
            Some("Speakers"),
            Some("Speakers"),
            &speakers
        ));
    }

    #[test]
    fn a_vanished_device_reopens_once_and_then_waits() {
        assert!(should_follow_device(
            Some("Bluetooth Headphones"),
            Some("Bluetooth Headphones"),
            Some("Speakers"),
            &["Speakers".to_string()]
        ));
        assert!(!should_follow_device(
            Some("Bluetooth Headphones"),
            Some("Speakers"),
            Some("Speakers"),
            &["Speakers".to_string()]
        ));
    }

    #[test]
    fn the_default_device_is_followed_on_non_pulse_hosts() {
        assert!(!should_follow_device(
            None,
            Some("Speakers"),
            Some("Speakers"),
            &["Speakers".to_string()]
        ));
        assert!(should_follow_device(
            None,
            Some("Speakers"),
            Some("Headphones"),
            &["Speakers".to_string(), "Headphones".to_string()]
        ));
        assert!(!should_follow_device(None, Some("Speakers"), None, &[]));
    }

    #[test]
    fn the_ui_receives_separate_input_and_output_lists() {
        let devices = AudioDevices {
            inputs: vec![DeviceInfo {
                id: device_id("CoreAudio", "MacBook Microphone"),
                friendly_name: "MacBook Microphone".into(),
                is_default: true,
            }],
            outputs: vec![DeviceInfo {
                id: device_id("CoreAudio", "MacBook Speakers"),
                friendly_name: "MacBook Speakers".into(),
                is_default: true,
            }],
        };
        let json = serde_json::to_value(devices).expect("serialize devices");
        assert_eq!(json["inputs"][0]["friendly_name"], "MacBook Microphone");
        assert_eq!(json["outputs"][0]["id"], "CoreAudio|MacBook Speakers");
        assert_eq!(json["inputs"][0]["is_default"], true);
    }
}
