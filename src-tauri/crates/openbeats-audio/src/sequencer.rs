//! Sequencer: turns the JSON project snapshot from the React frontend into
//! sample-accurate note triggers.
//!
//! The frontend sends a deliberately small snapshot (channels plus flattened
//! notes) so the Rust side never has to understand the whole editor model.

use serde::{Deserialize, Serialize};

use crate::clips::{expand_clip, PlaybackClip, PlaybackPattern};

/// One mixer channel as the native engine needs it.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PlaybackChannel {
    pub id: String,
    pub preset: String,
    #[serde(default = "unity")]
    pub gain: f32,
    #[serde(default)]
    pub pan: f32,
    #[serde(default)]
    pub mute: bool,
    #[serde(default)]
    pub solo: bool,
    #[serde(default = "middle_c")]
    pub root: u8,
    #[serde(default = "default_attack")]
    pub attack: f32,
    #[serde(default = "default_decay")]
    pub decay: f32,
    #[serde(default = "default_release")]
    pub release: f32,
    #[serde(default = "half")]
    pub tone: f32,
}

fn unity() -> f32 {
    1.0
}
fn half() -> f32 {
    0.5
}
fn middle_c() -> u8 {
    60
}
fn default_attack() -> f32 {
    0.05
}
fn default_decay() -> f32 {
    0.2
}
fn default_release() -> f32 {
    0.2
}

/// One note, already flattened from its pattern and clip.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PlaybackNote {
    pub channel: String,
    pub pitch: u8,
    /// Start in 16th-note steps.
    pub start: f32,
    /// Length in steps.
    pub len: f32,
    #[serde(default = "unity")]
    pub vel: f32,
    /// Clip gain envelope value at this note (1.0 = no change).
    #[serde(default = "unity")]
    pub gain: f32,
    /// Per-clip pan, overriding the channel pan when non-zero.
    #[serde(default)]
    pub pan: f32,
}

/// The playback request `start_playback` accepts.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PlaybackProject {
    pub bpm: f32,
    #[serde(default)]
    pub swing: f32,
    #[serde(default = "unity")]
    pub master_gain: f32,
    /// Total steps in the pattern or arrangement.
    pub steps: u32,
    /// Step to begin at, so a native transport can resume from the playhead.
    #[serde(default)]
    pub start_step: u32,
    #[serde(default)]
    pub loop_enabled: bool,
    #[serde(default)]
    pub loop_start: u32,
    #[serde(default)]
    pub loop_end: u32,
    #[serde(default)]
    pub channels: Vec<PlaybackChannel>,
    #[serde(default)]
    pub notes: Vec<PlaybackNote>,
    /// Playlist clips; when `patterns` is non-empty the sequencer expands the
    /// clips (gain, pan, pitch, stretch, fades) instead of using `notes`.
    #[serde(default)]
    pub clips: Vec<PlaybackClip>,
    #[serde(default)]
    pub patterns: Vec<PlaybackPattern>,
}

impl PlaybackProject {
    pub fn from_json(json: &str) -> Result<Self, String> {
        let project: Self =
            serde_json::from_str(json).map_err(|e| format!("invalid project data: {e}"))?;
        if project.bpm <= 0.0 || !project.bpm.is_finite() {
            return Err("bpm must be positive".into());
        }
        Ok(project)
    }

    /// Channels that should sound, honouring mute and solo.
    fn audible(&self) -> Vec<bool> {
        let any_solo = self.channels.iter().any(|c| c.solo);
        self.channels
            .iter()
            .map(|c| !c.mute && (!any_solo || c.solo))
            .collect()
    }

    /// Steps per second for the current tempo (16th-note steps).
    pub fn steps_per_second(&self) -> f32 {
        self.bpm / 60.0 * 4.0
    }
}

/// A note trigger produced at a step boundary.
#[derive(Clone, Debug, PartialEq)]
pub struct Trigger {
    pub channel_index: usize,
    pub pitch: u8,
    pub velocity: f32,
    pub duration_sec: f32,
    pub gain: f32,
    pub pan: f32,
}

/// Builds the note list the sequencer walks: clips when patterns are supplied,
/// otherwise the flat `notes` array.
fn flatten_notes(project: &PlaybackProject) -> Vec<PlaybackNote> {
    if project.patterns.is_empty() {
        return project.notes.clone();
    }
    let mut notes = Vec::new();
    for clip in &project.clips {
        let Some(pattern) = project.patterns.iter().find(|p| p.id == clip.pattern) else {
            continue;
        };
        notes.extend(
            expand_clip(clip, pattern)
                .into_iter()
                .map(|note| PlaybackNote {
                    channel: note.channel,
                    pitch: note.pitch,
                    start: note.start,
                    len: note.len,
                    vel: note.vel,
                    gain: note.gain,
                    pan: note.pan,
                }),
        );
    }
    notes
}

/// Walks the timeline one frame at a time and emits triggers on step changes.
pub struct Sequencer {
    project: PlaybackProject,
    /// Flattened notes: either the supplied `notes`, or clips expanded with
    /// their per-clip gain, pan, pitch, stretch and fades.
    notes: Vec<PlaybackNote>,
    sample_rate: f32,
    samples_per_step: f64,
    frame_in_step: f64,
    step: u32,
    playing: bool,
    finished: bool,
}

impl Sequencer {
    pub fn new(project: PlaybackProject, sample_rate: f32) -> Self {
        let samples_per_step = sample_rate as f64 / project.steps_per_second().max(0.001) as f64;
        let start = project
            .start_step
            .min(project.steps.max(1).saturating_sub(1));
        let notes = flatten_notes(&project);
        Self {
            project,
            notes,
            sample_rate,
            samples_per_step: samples_per_step.max(1.0),
            frame_in_step: 0.0,
            step: start,
            playing: true,
            finished: false,
        }
    }

    pub fn project(&self) -> &PlaybackProject {
        &self.project
    }

    pub fn step(&self) -> u32 {
        self.step
    }

    pub fn is_playing(&self) -> bool {
        self.playing
    }

    pub fn is_finished(&self) -> bool {
        self.finished
    }

    pub fn stop(&mut self) {
        self.playing = false;
    }

    /// Advances by one frame and returns the triggers that start on the new step.
    pub fn tick(&mut self) -> Vec<Trigger> {
        if !self.playing || self.finished {
            return Vec::new();
        }
        self.frame_in_step += 1.0;
        if self.frame_in_step < self.samples_per_step {
            return Vec::new();
        }
        self.frame_in_step -= self.samples_per_step;
        self.advance_step()
    }

    fn advance_step(&mut self) -> Vec<Trigger> {
        let total = self.project.steps.max(1);
        let loop_end = if self.project.loop_enabled {
            self.project.loop_end.clamp(1, total)
        } else {
            total
        };

        // Emit for the step we are on, then advance: otherwise step 0 is silent.
        let current = self.step;
        let audible = self.project.audible();
        let step_sec = self.samples_per_step as f32 / self.sample_rate;
        let mut triggers = Vec::new();

        for note in &self.notes {
            if note.start.round() as u32 != current {
                continue;
            }
            let Some(index) = self
                .project
                .channels
                .iter()
                .position(|c| c.id == note.channel)
            else {
                continue;
            };
            if !audible.get(index).copied().unwrap_or(false) {
                continue;
            }
            triggers.push(Trigger {
                channel_index: index,
                pitch: note.pitch,
                velocity: note.vel,
                duration_sec: (note.len.max(0.25) * step_sec * 0.96).max(0.01),
                gain: note.gain.max(0.0),
                pan: note.pan.clamp(-1.0, 1.0),
            });
        }

        self.step += 1;
        if self.step >= loop_end {
            if self.project.loop_enabled {
                self.step = self.project.loop_start.min(loop_end.saturating_sub(1));
            } else {
                self.playing = false;
                self.finished = true;
            }
        }
        triggers
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project() -> PlaybackProject {
        PlaybackProject {
            bpm: 120.0, // 8 steps per second
            swing: 0.0,
            master_gain: 1.0,
            steps: 16,
            start_step: 0,
            loop_enabled: false,
            loop_start: 0,
            loop_end: 16,
            channels: vec![
                PlaybackChannel {
                    id: "kick".into(),
                    preset: "kick".into(),
                    gain: 1.0,
                    pan: 0.0,
                    mute: false,
                    solo: false,
                    root: 36,
                    attack: 0.01,
                    decay: 0.2,
                    release: 0.1,
                    tone: 0.6,
                },
                PlaybackChannel {
                    id: "snare".into(),
                    preset: "snare".into(),
                    gain: 1.0,
                    pan: 0.0,
                    mute: false,
                    solo: false,
                    root: 38,
                    attack: 0.01,
                    decay: 0.2,
                    release: 0.1,
                    tone: 0.6,
                },
            ],
            notes: vec![
                PlaybackNote {
                    channel: "kick".into(),
                    pitch: 36,
                    start: 0.0,
                    len: 1.0,
                    vel: 1.0,
                    gain: 1.0,
                    pan: 0.0,
                },
                PlaybackNote {
                    channel: "snare".into(),
                    pitch: 38,
                    start: 4.0,
                    len: 1.0,
                    vel: 0.8,
                    gain: 0.5,
                    pan: 0.0,
                },
            ],
            clips: Vec::new(),
            patterns: Vec::new(),
        }
    }

    #[test]
    fn json_round_trip_accepts_the_frontend_snapshot() {
        let json = serde_json::to_string(&project()).unwrap();
        let parsed = PlaybackProject::from_json(&json).expect("parsed");
        assert_eq!(parsed.channels.len(), 2);
        assert_eq!(parsed.steps_per_second(), 8.0);
    }

    #[test]
    fn rejects_a_zero_tempo() {
        let mut p = project();
        p.bpm = 0.0;
        assert!(PlaybackProject::from_json(&serde_json::to_string(&p).unwrap()).is_err());
    }

    #[test]
    fn emits_triggers_on_the_right_steps() {
        let mut seq = Sequencer::new(project(), 8_000.0);
        // Step 0 fires after one step's worth of frames.
        let mut all = Vec::new();
        for _ in 0..(8_000 * 3) {
            all.extend(seq.tick());
        }
        assert!(!all.is_empty());
        assert_eq!(all[0].channel_index, 0);
        assert_eq!(all[0].pitch, 36);
        assert!((all[0].duration_sec - 0.12).abs() < 0.02);
    }

    #[test]
    fn clip_gain_is_carried_to_the_trigger() {
        let mut seq = Sequencer::new(project(), 8_000.0);
        let mut triggers = Vec::new();
        for _ in 0..(8_000 * 4) {
            triggers.extend(seq.tick());
        }
        let snare = triggers
            .iter()
            .find(|t| t.pitch == 38)
            .expect("snare triggered");
        assert!((snare.gain - 0.5).abs() < 1e-6);
    }

    #[test]
    fn mute_removes_a_channel_from_the_triggers() {
        let mut p = project();
        p.channels[0].mute = true;
        let mut seq = Sequencer::new(p, 8_000.0);
        let mut triggers = Vec::new();
        for _ in 0..(8_000 * 3) {
            triggers.extend(seq.tick());
        }
        assert!(
            triggers.iter().all(|t| t.pitch != 36),
            "muted kick triggered"
        );
        assert!(triggers.iter().any(|t| t.pitch == 38));
    }

    #[test]
    fn non_looping_playback_finishes_after_the_last_step() {
        let mut seq = Sequencer::new(project(), 8_000.0);
        for _ in 0..(8_000 * 4) {
            seq.tick();
        }
        assert!(seq.is_finished(), "transport never finished");
        assert!(!seq.is_playing());
    }

    #[test]
    fn looping_wraps_back_to_the_loop_start() {
        let mut p = project();
        p.loop_enabled = true;
        p.loop_start = 2;
        p.loop_end = 6;
        let mut seq = Sequencer::new(p, 8_000.0);
        for _ in 0..(8_000 * 6) {
            seq.tick();
        }
        assert!(
            seq.step() >= 2 && seq.step() < 6,
            "step out of loop: {}",
            seq.step()
        );
        assert!(!seq.is_finished());
    }

    #[test]
    fn resumes_from_the_requested_step() {
        let mut p = project();
        p.start_step = 4;
        let seq = Sequencer::new(p, 8_000.0);
        assert_eq!(
            seq.step(),
            4,
            "native transport did not resume from the playhead"
        );
    }

    #[test]
    fn clips_expand_with_their_per_clip_properties() {
        let mut p = project();
        p.notes.clear();
        p.patterns = vec![PlaybackPattern {
            id: "p1".into(),
            bars: 1,
            notes: vec![crate::clips::PlaybackPatternNote {
                channel: "kick".into(),
                pitch: 36,
                start: 0.0,
                len: 1.0,
                vel: 1.0,
            }],
        }];
        p.clips = vec![PlaybackClip {
            id: "c1".into(),
            pattern: "p1".into(),
            track: 0,
            start: 0.0,
            len: 16.0,
            gain: 0.5,
            pan: 0.5,
            pitch: 12,
            stretch: 1.0,
            fade_in: 0.0,
            fade_out: 0.0,
            muted: false,
        }];
        let mut seq = Sequencer::new(p, 8_000.0);
        let mut triggers = Vec::new();
        for _ in 0..(8_000 * 2) {
            triggers.extend(seq.tick());
        }
        let first = triggers.first().expect("clip note triggered");
        assert_eq!(first.pitch, 48, "clip pitch offset not applied");
        assert!((first.gain - 0.5).abs() < 1e-6);
        assert!((first.pan - 0.5).abs() < 1e-6);
    }

    #[test]
    fn start_step_is_clamped_into_the_timeline() {
        let mut p = project();
        p.start_step = 9_999;
        let seq = Sequencer::new(p, 8_000.0);
        assert!(
            seq.step() < 16,
            "start step escaped the timeline: {}",
            seq.step()
        );
    }
}
