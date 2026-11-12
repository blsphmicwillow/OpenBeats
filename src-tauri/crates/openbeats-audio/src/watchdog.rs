//! What to do when the device stops calling back.
//!
//! The first 1.0.9 release candidate reopened the stream on every stall with the
//! same buffer, so a Bluetooth sink that could not sustain 58 frames produced 16
//! reopens in 30 seconds, eight different node ids, and no error the user could
//! see. The policy here is deliberately small and pure so it can be tested with a
//! fake clock: escalate the buffer once per stall, cap the attempts in a window,
//! then stop and report instead of looping.

/// A stream that has not called back for this long is treated as stalled.
///
/// Two seconds is roughly 88 000 frames at 44.1 kHz: far longer than any
/// scheduling hiccup, and short enough that a real stall is noticed while the
/// user is still looking at the transport.
pub const DETECT_MS: u64 = 2_000;

/// Reopens are only counted within this window.
pub const WINDOW_MS: u64 = 30_000;

/// Escalation ladder: the buffer requested on each successive stall. A frozen
/// callback is far more often "the graph cannot keep up" than "the device is
/// broken", so a bigger buffer is tried before giving up.
pub const LADDER: [u32; 3] = [256, 512, 1024];

/// Reopens allowed inside [`WINDOW_MS`] before the engine stops trying.
pub const MAX_REOPENS: u32 = 3;

/// What the watchdog should do about one stall.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StallAction {
    /// Rebuild the stream asking for this many frames.
    Reopen { attempt: u32, buffer_frames: u32 },
    /// Stop reopening; the caller shows a persistent error instead.
    GiveUp { attempts: u32 },
}

/// Backoff state. One instance lives for the lifetime of the audio thread and is
/// reset when the user changes the device, the latency setting or presses play.
#[derive(Debug, Default)]
pub struct StallPolicy {
    attempts: Vec<u64>,
}

impl StallPolicy {
    pub fn new() -> Self {
        Self { attempts: Vec::new() }
    }

    /// Reopens recorded inside the current window.
    pub fn attempts(&self) -> u32 {
        self.attempts.len() as u32
    }

    /// Forgets attempts that fell out of the window.
    fn prune(&mut self, now_ms: u64) {
        self.attempts
            .retain(|at| now_ms.saturating_sub(*at) <= WINDOW_MS);
    }

    /// Decides what to do about a stall observed at `now_ms`.
    pub fn on_stall(&mut self, now_ms: u64) -> StallAction {
        self.prune(now_ms);
        if self.attempts.len() as u32 >= MAX_REOPENS {
            return StallAction::GiveUp {
                attempts: self.attempts.len() as u32,
            };
        }
        let attempt = self.attempts.len() as u32 + 1;
        self.attempts.push(now_ms);
        StallAction::Reopen {
            attempt,
            buffer_frames: LADDER[(attempt - 1) as usize],
        }
    }

    /// Callbacks are flowing again; attempts that aged out no longer count.
    pub fn on_healthy(&mut self, now_ms: u64) {
        self.prune(now_ms);
    }
}

/// Whether a quiet stretch is a stall.
///
/// `callbacks_changed` is the only progress signal that matters: the transport
/// counter does not advance while paused, so using it would fire on a paused
/// transport. A stream that is not playing is idle, not stalled.
pub fn is_stalled(callbacks_changed: bool, playing: bool, silent_ms: u64) -> bool {
    playing && !callbacks_changed && silent_ms >= DETECT_MS
}

/// One line per stall-triggered reopen, for the log and for Copy diagnostics.
pub fn reopen_line(
    attempt: u32,
    reason: &str,
    silent_ms: u64,
    requested: u32,
    previous_granted: u32,
) -> String {
    let previous = if previous_granted > 0 {
        format!("{previous_granted} frames granted before")
    } else {
        "no buffer grant recorded".to_string()
    };
    format!(
        "stall reopen {attempt}/{MAX_REOPENS}: {reason} after {silent_ms} ms without a callback; requesting {requested} frames ({previous})"
    )
}

/// The message shown when the cap is reached. It has to be self-contained: the
/// user gets it once, and it should not require a terminal to act on.
pub fn give_up_message(attempts: u32, requested: u32, granted: u32, low_latency: bool) -> String {
    format!(
        "Audio stalled {attempts} times in {} s and the stream was not reopened again. \
Last attempt requested {requested} frames, the device granted {granted}; low-latency mode is {}. \
Turn Low-latency mode off, pick another output in Audio settings, or use a larger buffer.",
        WINDOW_MS / 1_000,
        if low_latency { "on" } else { "off" }
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fake stalling device: it never calls back, so every observation is a
    /// stall. The clock is the only input.
    #[test]
    fn escalates_then_stops_instead_of_looping() {
        let mut policy = StallPolicy::new();
        assert_eq!(
            policy.on_stall(1_000),
            StallAction::Reopen {
                attempt: 1,
                buffer_frames: 256
            }
        );
        assert_eq!(
            policy.on_stall(2_000),
            StallAction::Reopen {
                attempt: 2,
                buffer_frames: 512
            }
        );
        assert_eq!(
            policy.on_stall(3_000),
            StallAction::Reopen {
                attempt: 3,
                buffer_frames: 1024
            }
        );
        // The sixteenth reopen the tester saw must not happen: the fourth stall
        // inside the window gives up.
        assert_eq!(policy.on_stall(4_000), StallAction::GiveUp { attempts: 3 });
    }

    #[test]
    fn the_cap_is_a_window_not_a_total() {
        let mut policy = StallPolicy::new();
        policy.on_stall(1_000);
        policy.on_stall(2_000);
        policy.on_stall(3_000);
        assert_eq!(policy.on_stall(4_000), StallAction::GiveUp { attempts: 3 });
        // A stall two minutes later starts the ladder again from the smallest
        // buffer: long stretches of healthy audio must not be punished.
        assert_eq!(
            policy.on_stall(124_000),
            StallAction::Reopen {
                attempt: 1,
                buffer_frames: 256
            }
        );
    }

    #[test]
    fn healthy_progress_ages_attempts_out() {
        let mut policy = StallPolicy::new();
        policy.on_stall(1_000);
        policy.on_stall(2_000);
        policy.on_healthy(40_000);
        assert_eq!(policy.attempts(), 0);
        assert_eq!(
            policy.on_stall(41_000),
            StallAction::Reopen {
                attempt: 1,
                buffer_frames: 256
            }
        );
    }

    #[test]
    fn paused_transport_and_idle_streams_are_not_stalls() {
        // Frozen callbacks while playing: a real stall.
        assert!(is_stalled(false, true, DETECT_MS));
        // Frozen callbacks while not playing: idle, not stalled.
        assert!(!is_stalled(false, false, 60_000));
        // Callbacks still arriving: progress, even if the transport is paused.
        assert!(!is_stalled(true, true, 60_000));
        // Frozen, playing, but inside the window: too early to call it.
        assert!(!is_stalled(false, true, DETECT_MS - 1));
    }

    #[test]
    fn the_reopen_line_records_both_buffers() {
        let line = reopen_line(2, "no callback while playing", 2_140, 512, 58);
        assert!(line.contains("stall reopen 2/3"));
        assert!(line.contains("2 140 ms") || line.contains("2140 ms"));
        assert!(line.contains("requesting 512 frames"));
        assert!(line.contains("58 frames granted before"));
    }

    #[test]
    fn the_give_up_message_carries_the_stats_and_a_next_step() {
        let message = give_up_message(3, 1024, 58, true);
        assert!(message.contains("3 times in 30 s"));
        assert!(message.contains("1024"));
        assert!(message.contains("58"));
        assert!(message.contains("low-latency mode is on"));
        assert!(message.contains("Turn Low-latency mode off"));
    }
}
