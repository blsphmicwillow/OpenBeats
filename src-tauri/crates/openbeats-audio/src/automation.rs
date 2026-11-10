//! Automation: envelope lanes that drive any engine parameter.
//!
//! A lane is a list of points over time (in 16th steps) plus the range of the
//! parameter it targets. Values are read on demand, so the same lane can drive a
//! per-sample engine parameter or be sampled per step by the sequencer.
//!
//! Curves follow the automation-clip semantics: linear ramps, a hold step, and
//! the common eased shapes.

use serde::{Deserialize, Serialize};

/// Interpolation from a point to the next one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Curve {
    Linear,
    /// Stay at this point's value until the next point.
    Hold,
    EaseIn,
    EaseOut,
    SCurve,
}

impl Default for Curve {
    fn default() -> Self {
        Curve::Linear
    }
}

/// One envelope point.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
pub struct AutomationPoint {
    /// Position in 16th steps.
    pub time: f32,
    /// Normalised 0..=1 value, mapped through the lane range.
    pub value: f32,
    #[serde(default)]
    pub curve: Curve,
}

impl AutomationPoint {
    pub fn new(time: f32, value: f32) -> Self {
        Self {
            time,
            value,
            curve: Curve::Linear,
        }
    }

    pub fn with_curve(time: f32, value: f32, curve: Curve) -> Self {
        Self { time, value, curve }
    }
}

fn shape(curve: Curve, t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    match curve {
        Curve::Linear => t,
        Curve::Hold => 0.0,
        Curve::EaseIn => t * t,
        Curve::EaseOut => 1.0 - (1.0 - t) * (1.0 - t),
        Curve::SCurve => t * t * (3.0 - 2.0 * t),
    }
}

/// One automated parameter.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct AutomationLane {
    /// Parameter name, e.g. `master_gain` or `channel:kick:pan`.
    pub target: String,
    /// Value used before the first point and after the last one.
    #[serde(default)]
    pub default: f32,
    /// Low end of the parameter's range.
    #[serde(default)]
    pub min: f32,
    /// High end of the parameter's range.
    #[serde(default = "one")]
    pub max: f32,
    /// When set, the lane repeats every `loop_len` steps.
    #[serde(default)]
    pub loop_len: Option<f32>,
    #[serde(default)]
    pub points: Vec<AutomationPoint>,
}

fn one() -> f32 {
    1.0
}

impl AutomationLane {
    pub fn new(target: &str, min: f32, max: f32) -> Self {
        Self {
            target: target.to_string(),
            default: min,
            min,
            max,
            loop_len: None,
            points: Vec::new(),
        }
    }

    pub fn with_points(mut self, points: Vec<AutomationPoint>) -> Self {
        self.points = points;
        self.points.sort_by(|a, b| {
            a.time
                .partial_cmp(&b.time)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        self
    }

    fn normalised_at(&self, time: f32) -> Option<f32> {
        if self.points.is_empty() {
            return None;
        }
        let time = if let Some(len) = self.loop_len {
            if len > 0.0 && time >= len {
                time % len
            } else {
                time
            }
        } else {
            time
        };

        if time <= self.points[0].time {
            return Some(self.points[0].value);
        }
        let last = self.points[self.points.len() - 1];
        if time >= last.time {
            return Some(last.value);
        }

        for pair in self.points.windows(2) {
            let (a, b) = (pair[0], pair[1]);
            if time >= a.time && time <= b.time {
                let span = (b.time - a.time).max(1e-6);
                let t = (time - a.time) / span;
                let shaped = if a.curve == Curve::Hold {
                    0.0
                } else {
                    shape(a.curve, t)
                };
                return Some(a.value + (b.value - a.value) * shaped);
            }
        }
        Some(last.value)
    }

    /// The lane's value in parameter units at `time` (steps).
    pub fn value_at(&self, time: f32) -> f32 {
        match self.normalised_at(time) {
            Some(normalised) => {
                let normalised = normalised.clamp(0.0, 1.0);
                self.min + (self.max - self.min) * normalised
            }
            None => self.default,
        }
    }

    /// Samples the lane once per step, for `steps` steps.
    pub fn sample_steps(&self, steps: u32) -> Vec<f32> {
        (0..steps).map(|step| self.value_at(step as f32)).collect()
    }
}

/// Every lane in a project, applied to named parameters.
#[derive(Debug, Clone, Default, PartialEq, Deserialize, Serialize)]
pub struct AutomationSet {
    #[serde(default)]
    pub lanes: Vec<AutomationLane>,
}

impl AutomationSet {
    pub fn new(lanes: Vec<AutomationLane>) -> Self {
        Self { lanes }
    }

    /// The first lane targeting `target`, if any.
    pub fn lane(&self, target: &str) -> Option<&AutomationLane> {
        self.lanes.iter().find(|lane| lane.target == target)
    }

    /// Value for `target` at `time`, or `fallback` when it is not automated.
    pub fn value(&self, target: &str, time: f32, fallback: f32) -> f32 {
        self.lane(target)
            .map(|lane| lane.value_at(time))
            .unwrap_or(fallback)
    }

    /// Writes every lane's current value into `values`, keyed by target.
    pub fn apply(&self, time: f32, values: &mut std::collections::BTreeMap<String, f32>) {
        for lane in &self.lanes {
            values.insert(lane.target.clone(), lane.value_at(time));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lane() -> AutomationLane {
        AutomationLane::new("master_gain", 0.0, 2.0).with_points(vec![
            AutomationPoint::new(0.0, 0.0),
            AutomationPoint::new(8.0, 1.0),
        ])
    }

    #[test]
    fn linear_ramp_hits_the_midpoint() {
        let l = lane();
        assert!(
            (l.value_at(4.0) - 1.0).abs() < 1e-6,
            "got {}",
            l.value_at(4.0)
        );
    }

    #[test]
    fn values_before_and_after_the_points_clamp() {
        let l = lane();
        assert!((l.value_at(-4.0) - 0.0).abs() < 1e-6);
        assert!((l.value_at(64.0) - 2.0).abs() < 1e-6);
    }

    #[test]
    fn hold_ignores_the_ramp_until_the_next_point() {
        let l = AutomationLane::new("pan", -1.0, 1.0).with_points(vec![
            AutomationPoint::with_curve(0.0, 0.0, Curve::Hold),
            AutomationPoint::new(8.0, 1.0),
        ]);
        // Held at the low end until step 8, then the mapped value jumps to max.
        assert!(
            (l.value_at(7.9) - -1.0).abs() < 1e-6,
            "got {}",
            l.value_at(7.9)
        );
        assert!((l.value_at(8.0) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn eased_curves_are_monotonic_and_inside_the_range() {
        for curve in [Curve::EaseIn, Curve::EaseOut, Curve::SCurve] {
            let l = AutomationLane::new("tone", 0.0, 1.0).with_points(vec![
                AutomationPoint::with_curve(0.0, 0.0, curve),
                AutomationPoint::new(16.0, 1.0),
            ]);
            let mut previous = -1.0;
            for step in 0..=16 {
                let value = l.value_at(step as f32);
                assert!(value >= previous - 1e-6, "{curve:?} went backwards");
                assert!((0.0..=1.0).contains(&value));
                previous = value;
            }
        }
    }

    #[test]
    fn a_looping_lane_wraps_back() {
        let mut l = lane();
        l.loop_len = Some(8.0);
        assert!((l.value_at(8.0) - 0.0).abs() < 1e-6);
        assert!((l.value_at(12.0) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn bipolar_ranges_map_below_zero() {
        let l = AutomationLane::new("pan", -1.0, 1.0).with_points(vec![
            AutomationPoint::new(0.0, 0.0),
            AutomationPoint::new(4.0, 1.0),
        ]);
        assert!((l.value_at(0.0) - -1.0).abs() < 1e-6);
        assert!((l.value_at(2.0) - 0.0).abs() < 1e-6);
    }

    #[test]
    fn an_empty_lane_returns_its_default() {
        let mut l = AutomationLane::new("cutoff", 200.0, 12_000.0);
        l.default = 1_000.0;
        assert!((l.value_at(10.0) - 1_000.0).abs() < 1e-3);
    }

    #[test]
    fn points_given_out_of_order_are_sorted() {
        let l = AutomationLane::new("gain", 0.0, 1.0).with_points(vec![
            AutomationPoint::new(8.0, 1.0),
            AutomationPoint::new(0.0, 0.0),
        ]);
        assert!((l.value_at(4.0) - 0.5).abs() < 1e-6);
    }

    #[test]
    fn sampling_once_per_step_returns_one_value_per_step() {
        let values = lane().sample_steps(4);
        assert_eq!(values.len(), 4);
        assert!((values[0] - 0.0).abs() < 1e-6);
        assert!(values[3] > 0.0 && values[3] < 2.0);
    }

    #[test]
    fn the_set_applies_only_the_lanes_it_has() {
        let set = AutomationSet::new(vec![lane()]);
        let mut values = std::collections::BTreeMap::new();
        values.insert("channel:kick:pan".to_string(), 0.25);
        set.apply(4.0, &mut values);
        assert!((values["master_gain"] - 1.0).abs() < 1e-6);
        assert!((values["channel:kick:pan"] - 0.25).abs() < 1e-6);
        assert!((set.value("unknown", 0.0, 0.75) - 0.75).abs() < 1e-6);
    }
}
