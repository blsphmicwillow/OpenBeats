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

/// Description of one enumerated device for the settings UI.
#[derive(Debug, Clone, serde::Serialize)]
pub struct AudioDeviceInfo {
    pub name: String,
    /// `"output"` or `"input"`.
    pub kind: String,
    pub host: String,
    pub is_default: bool,
    pub channels: u16,
    pub sample_rate: u32,
    /// True for the PulseAudio/PipeWire bridge on Linux.
    pub is_pulse_bridge: bool,
}

impl AudioDeviceInfo {
    pub fn new(name: impl Into<String>, kind: &str, host: impl Into<String>) -> Self {
        let name = name.into();
        Self {
            is_pulse_bridge: is_pulse_bridge(&name),
            name,
            kind: kind.into(),
            host: host.into(),
            is_default: false,
            channels: 2,
            sample_rate: 48_000,
        }
    }
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
}
