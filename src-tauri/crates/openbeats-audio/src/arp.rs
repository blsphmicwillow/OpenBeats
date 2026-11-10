//! Real-time note arpeggiator.
//!
//! Held notes are kept in the order they were pressed; the arpeggiator walks
//! them at a rhythmic rate and emits note-on/note-off pairs with a gate length,
//! so a synth can play a chord as a pattern without the UI scheduling every note.

use serde::{Deserialize, Serialize};

use crate::piano_tools::ArpMode;

/// What the arpeggiator wants the synth to do this block.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArpEvent {
    NoteOn(u8),
    NoteOff(u8),
}

/// Held-note arpeggiator.
#[derive(Debug, Clone)]
pub struct Arpeggiator {
    held: Vec<u8>,
    pub mode: ArpMode,
    /// Length of one arpeggio step in 16th steps.
    pub rate_steps: f32,
    pub octaves: u8,
    /// Fraction of the step the note sounds for.
    pub gate: f32,
    sample_rate: f32,
    step_sec: f32,
    step_index: usize,
    /// Samples until the next step.
    frames_to_step: f32,
    /// Samples until the current note is released, if one is sounding.
    release_in: Option<f32>,
    sounding: Option<u8>,
    enabled: bool,
}

impl Arpeggiator {
    pub fn new(sample_rate: f32, bpm: f32) -> Self {
        Self {
            held: Vec::new(),
            mode: ArpMode::Up,
            rate_steps: 1.0,
            octaves: 1,
            gate: 0.6,
            sample_rate,
            step_sec: 60.0 / bpm.max(20.0) / 4.0,
            step_index: 0,
            frames_to_step: 0.0,
            release_in: None,
            sounding: None,
            enabled: true,
        }
    }

    pub fn set_tempo(&mut self, bpm: f32) {
        self.step_sec = 60.0 / bpm.clamp(20.0, 300.0) / 4.0;
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        if !enabled {
            let _ = self.release();
        }
        self.enabled = enabled;
    }

    pub fn note_on(&mut self, pitch: u8) {
        if !self.held.contains(&pitch) {
            self.held.push(pitch);
        }
    }

    pub fn note_off(&mut self, pitch: u8) {
        self.held.retain(|held| *held != pitch);
        if self.held.is_empty() {
            let _ = self.release();
        }
    }

    pub fn held(&self) -> &[u8] {
        &self.held
    }

    pub fn sounding(&self) -> Option<u8> {
        self.sounding
    }

    /// The pattern order for the currently held notes.
    pub fn sequence(&self) -> Vec<u8> {
        if self.held.is_empty() {
            return Vec::new();
        }
        let mut base = self.held.clone();
        match self.mode {
            ArpMode::Up => base.sort_unstable(),
            ArpMode::Down => base.sort_unstable_by(|a, b| b.cmp(a)),
            ArpMode::AsPlayed => {}
            ArpMode::UpDown => {
                base.sort_unstable();
                let mut down: Vec<u8> = base.iter().rev().skip(1).copied().collect();
                down.pop();
                base.extend(down);
            }
        }
        let octaves = self.octaves.max(1) as u16;
        if octaves == 1 {
            return base;
        }
        let original = base.clone();
        for octave in 1..octaves {
            for pitch in &original {
                let shifted = *pitch as u16 + 12 * octave;
                if shifted <= 127 {
                    base.push(shifted as u8);
                }
            }
        }
        base
    }

    fn release(&mut self) -> Option<ArpEvent> {
        self.release_in = None;
        self.sounding.take().map(ArpEvent::NoteOff)
    }

    /// Advances by `frames` samples and returns the events for that block.
    ///
    /// At most one note-on and one note-off are produced per call; a block that
    /// crosses several steps is fine because the next call continues from where
    /// this one stopped.
    pub fn advance(&mut self, frames: usize) -> Vec<ArpEvent> {
        let mut events = Vec::new();
        if !self.enabled || self.held.is_empty() {
            self.frames_to_step = 0.0;
            return events;
        }
        let frames = frames as f32;

        if let Some(remaining) = self.release_in {
            // Compare against half a frame so the gate cannot hang on the
            // tiny error left by scaling a step length by a float gate.
            let remaining = remaining - frames;
            if remaining <= 0.5 {
                self.release_in = None;
                if let Some(pitch) = self.sounding.take() {
                    events.push(ArpEvent::NoteOff(pitch));
                }
            } else {
                self.release_in = Some(remaining);
            }
        }

        self.frames_to_step -= frames;
        if self.frames_to_step > 0.0 {
            return events;
        }

        let sequence = self.sequence();
        if sequence.is_empty() {
            return events;
        }
        let pitch = sequence[self.step_index % sequence.len()];
        self.step_index = (self.step_index + 1) % sequence.len().max(1);
        self.frames_to_step = (self.step_sec * self.sample_rate).max(1.0);
        // Never leave a note hanging when a step arrives before the gate ended.
        if let Some(previous) = self.sounding.take() {
            events.push(ArpEvent::NoteOff(previous));
        }
        self.sounding = Some(pitch);
        self.release_in = Some((self.frames_to_step * self.gate.clamp(0.05, 1.0)).round());
        events.push(ArpEvent::NoteOn(pitch));
        events
    }

    pub fn reset(&mut self) {
        self.held.clear();
        self.release_in = None;
        self.sounding = None;
        self.step_index = 0;
        self.frames_to_step = 0.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;
    const BPM: f32 = 120.0; // one 16th = 0.125 s = 6000 frames

    fn arp() -> Arpeggiator {
        Arpeggiator::new(SR, BPM)
    }

    #[test]
    fn no_held_notes_means_no_events() {
        let mut arp = arp();
        assert!(arp.advance(6_000).is_empty());
    }

    #[test]
    fn held_notes_are_arpeggiated_in_order() {
        let mut arp = arp();
        for pitch in [64, 60, 67] {
            arp.note_on(pitch);
        }
        assert_eq!(arp.sequence(), vec![60, 64, 67], "up mode must sort");

        let first = arp.advance(6_000);
        assert_eq!(first, vec![ArpEvent::NoteOn(60)]);
        let second = arp.advance(6_000);
        assert!(second.contains(&ArpEvent::NoteOn(64)), "got {second:?}");
    }

    #[test]
    fn the_gate_releases_the_note_before_the_next_step() {
        let mut arp = arp();
        arp.note_on(60);
        let mut events = arp.advance(6_000);
        assert_eq!(events, vec![ArpEvent::NoteOn(60)]);
        // Gate is 60% of 6000 frames, so 3600 frames later it should release.
        events = arp.advance(3_600);
        assert!(events.contains(&ArpEvent::NoteOff(60)), "got {events:?}");
    }

    #[test]
    fn releasing_a_note_removes_it_from_the_pattern() {
        let mut arp = arp();
        arp.note_on(60);
        arp.note_on(64);
        arp.note_off(60);
        assert_eq!(arp.sequence(), vec![64]);
    }

    #[test]
    fn releasing_every_note_stops_the_arp() {
        let mut arp = arp();
        arp.note_on(60);
        arp.advance(6_000);
        let events = {
            arp.note_off(60);
            arp.advance(6_000)
        };
        assert!(
            events
                .iter()
                .all(|event| matches!(event, ArpEvent::NoteOff(_))),
            "got {events:?}"
        );
    }

    #[test]
    fn down_mode_reverses_the_pattern() {
        let mut arp = arp();
        arp.mode = ArpMode::Down;
        for pitch in [60, 64, 67] {
            arp.note_on(pitch);
        }
        assert_eq!(arp.sequence(), vec![67, 64, 60]);
    }

    #[test]
    fn octaves_repeat_the_pattern_upwards() {
        let mut arp = arp();
        arp.octaves = 2;
        arp.note_on(60);
        arp.note_on(64);
        assert_eq!(arp.sequence(), vec![60, 64, 72, 76]);
    }

    #[test]
    fn the_step_length_follows_the_tempo() {
        let mut arp = arp();
        arp.set_tempo(60.0);
        arp.note_on(60);
        // At 60 BPM a 16th is 0.25 s: 6000 frames must not reach the next step.
        assert_eq!(arp.advance(6_000), vec![ArpEvent::NoteOn(60)]);
        let later = arp.advance(6_000);
        assert!(
            !later.contains(&ArpEvent::NoteOn(60)),
            "stepped too early: {later:?}"
        );
    }

    #[test]
    fn disabling_the_arp_releases_the_note() {
        let mut arp = arp();
        arp.note_on(60);
        arp.advance(6_000);
        arp.set_enabled(false);
        assert!(arp.sounding().is_none());
        assert!(arp.advance(6_000).is_empty());
    }

    #[test]
    fn reset_clears_everything() {
        let mut arp = arp();
        arp.note_on(60);
        arp.advance(6_000);
        arp.reset();
        assert!(arp.held().is_empty());
        assert!(arp.sounding().is_none());
    }
}
