//! Playlist clip tools: slice, chop, quantize, trim and duplicate.
//!
//! A clip is described by its position and length in 16th-note steps. These
//! functions never touch project state, so the same maths serves the Rust engine
//! and the React playlist through Tauri commands.

use serde::{Deserialize, Serialize};

/// A clip's position and length in steps.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
pub struct ClipSpan {
    pub start: f32,
    pub len: f32,
}

impl ClipSpan {
    pub fn new(start: f32, len: f32) -> Self {
        Self { start, len }
    }

    pub fn end(&self) -> f32 {
        self.start + self.len
    }

    pub fn contains(&self, step: f32) -> bool {
        step >= self.start && step < self.end()
    }
}

/// Splits a clip at `step`, returning the left and right halves.
///
/// Returns `None` when the point is not strictly inside the clip (slicing at an
/// edge would produce an empty clip).
pub fn slice(clip: ClipSpan, at: f32) -> Option<(ClipSpan, ClipSpan)> {
    if at <= clip.start || at >= clip.end() {
        return None;
    }
    Some((
        ClipSpan::new(clip.start, at - clip.start),
        ClipSpan::new(at, clip.end() - at),
    ))
}

/// Splits a clip into `pieces` equal parts, dropping empty remainders.
pub fn chop(clip: ClipSpan, pieces: u32) -> Vec<ClipSpan> {
    let pieces = pieces.max(1);
    if clip.len <= 0.0 {
        return Vec::new();
    }
    let part = clip.len / pieces as f32;
    (0..pieces)
        .map(|i| ClipSpan::new(clip.start + part * i as f32, part))
        .collect()
}

/// Rounds a clip start to the nearest multiple of `grid` steps (0 = no snap).
pub fn quantize_start(start: f32, grid: f32) -> f32 {
    if grid <= 0.0 {
        return start.max(0.0);
    }
    (start / grid).round() * grid
}

/// Shortens (or extends) a clip. Length is clamped to a minimum of one step.
pub fn trim(clip: ClipSpan, new_len: f32) -> ClipSpan {
    ClipSpan::new(clip.start, new_len.max(0.0625))
}

/// Repeats a clip `count` times, each copy `gap` steps after the previous one.
pub fn duplicate(clip: ClipSpan, count: u32, gap: f32) -> Vec<ClipSpan> {
    let count = count.max(1);
    (0..count)
        .map(|i| ClipSpan::new(clip.start + (clip.len + gap) * i as f32, clip.len))
        .collect()
}

/// Index of the clip covering `step`, if any (last one wins for overlaps).
pub fn clip_at(clips: &[ClipSpan], step: f32) -> Option<usize> {
    clips.iter().rposition(|clip| clip.contains(step))
}

/// Merges a range of clips into the smallest span covering them.
pub fn consolidate(clips: &[ClipSpan]) -> Option<ClipSpan> {
    let first = clips.first()?;
    let start = clips.iter().map(|c| c.start).fold(first.start, f32::min);
    let end = clips.iter().map(|c| c.end()).fold(first.end(), f32::max);
    Some(ClipSpan::new(start, end - start))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slicing_preserves_the_total_length() {
        let clip = ClipSpan::new(4.0, 16.0);
        let (left, right) = slice(clip, 12.0).expect("inside the clip");
        assert!((left.len + right.len - clip.len).abs() < 1e-6);
        assert_eq!(left.start, 4.0);
        assert_eq!(left.len, 8.0);
        assert_eq!(right.start, 12.0);
        assert_eq!(right.len, 8.0);
    }

    #[test]
    fn slicing_at_the_edges_is_refused() {
        let clip = ClipSpan::new(4.0, 8.0);
        assert!(slice(clip, 4.0).is_none());
        assert!(slice(clip, 12.0).is_none());
        assert!(slice(clip, 2.0).is_none());
    }

    #[test]
    fn chopping_produces_equal_parts_that_cover_the_clip() {
        let clip = ClipSpan::new(0.0, 8.0);
        let parts = chop(clip, 4);
        assert_eq!(parts.len(), 4);
        assert!((parts.iter().map(|p| p.len).sum::<f32>() - 8.0).abs() < 1e-6);
        assert_eq!(parts[3].start, 6.0);
    }

    #[test]
    fn chopping_a_zero_length_clip_yields_nothing() {
        assert!(chop(ClipSpan::new(0.0, 0.0), 4).is_empty());
    }

    #[test]
    fn quantize_snaps_to_the_grid() {
        assert!((quantize_start(3.2, 4.0) - 4.0).abs() < 1e-6);
        assert!((quantize_start(1.4, 4.0) - 0.0).abs() < 1e-6);
        // A grid of zero means no snapping, but never a negative start.
        assert!((quantize_start(-2.0, 0.0) - 0.0).abs() < 1e-6);
    }

    #[test]
    fn trim_keeps_a_positive_length() {
        assert_eq!(trim(ClipSpan::new(2.0, 8.0), 4.0), ClipSpan::new(2.0, 4.0));
        assert!(trim(ClipSpan::new(2.0, 8.0), -3.0).len > 0.0);
    }

    #[test]
    fn duplicate_lays_copies_end_to_end() {
        let copies = duplicate(ClipSpan::new(0.0, 4.0), 3, 0.0);
        assert_eq!(copies.len(), 3);
        assert_eq!(copies[1].start, 4.0);
        assert_eq!(copies[2].start, 8.0);
    }

    #[test]
    fn duplicate_can_leave_a_gap() {
        let copies = duplicate(ClipSpan::new(0.0, 4.0), 2, 2.0);
        assert_eq!(copies[1].start, 6.0);
    }

    #[test]
    fn clip_lookup_prefers_the_topmost_overlap() {
        let clips = vec![ClipSpan::new(0.0, 8.0), ClipSpan::new(4.0, 8.0)];
        assert_eq!(clip_at(&clips, 5.0), Some(1));
        assert_eq!(clip_at(&clips, 1.0), Some(0));
        assert_eq!(clip_at(&clips, 20.0), None);
    }

    #[test]
    fn consolidate_covers_every_clip() {
        let clips = vec![ClipSpan::new(4.0, 4.0), ClipSpan::new(16.0, 2.0)];
        let merged = consolidate(&clips).unwrap();
        assert_eq!(merged.start, 4.0);
        assert!((merged.end() - 18.0).abs() < 1e-6);
        assert!(consolidate(&[]).is_none());
    }
}
