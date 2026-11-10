//! Velocity curve shapes for the piano roll's curve editor.

/// The shapes offered by the curve editor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VelocityCurve {
    Linear,
    Exponential,
    Logarithmic,
    SCurve,
    Compress,
}

impl VelocityCurve {
    pub fn parse(value: &str) -> Self {
        match value.trim().to_lowercase().as_str() {
            "exponential" | "exp" => Self::Exponential,
            "logarithmic" | "log" => Self::Logarithmic,
            "scurve" | "s-curve" | "s" => Self::SCurve,
            "compress" | "flat" => Self::Compress,
            _ => Self::Linear,
        }
    }
}

fn shape(kind: VelocityCurve, x: f32) -> f32 {
    let x = x.clamp(0.0, 1.0);
    match kind {
        VelocityCurve::Linear => x,
        VelocityCurve::Exponential => x * x,
        VelocityCurve::Logarithmic => x.sqrt(),
        VelocityCurve::SCurve => x * x * (3.0 - 2.0 * x),
        VelocityCurve::Compress => 0.5 + (x - 0.5) * 0.5,
    }
}

/// Applies a curve to a run of velocities.
///
/// `amount` 0 leaves the velocities untouched, 1 is the full curve. Values stay
/// inside 1..=127 and the first and last velocity are used as the curve's
/// endpoints, so drawing over a selection keeps its dynamic range.
pub fn apply(velocities: &[u8], kind: VelocityCurve, amount: f32) -> Vec<u8> {
    if velocities.is_empty() {
        return Vec::new();
    }
    let amount = amount.clamp(0.0, 1.0);
    let low = *velocities.iter().min().unwrap_or(&1) as f32;
    let high = *velocities.iter().max().unwrap_or(&127) as f32;
    let span = (high - low).max(1.0);
    velocities
        .iter()
        .map(|velocity| {
            let x = (*velocity as f32 - low) / span;
            let curved = low + shape(kind, x) * span;
            // Blend towards the curve so amount 0 is a true no-op.
            let blended = *velocity as f32 + (curved - *velocity as f32) * amount;
            blended.round().clamp(1.0, 127.0) as u8
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn amount_zero_is_identity() {
        let input = [100u8, 20, 55, 90];
        assert_eq!(apply(&input, VelocityCurve::Exponential, 0.0), input);
    }

    #[test]
    fn exponential_pushes_low_values_down_and_keeps_endpoints() {
        let input = [1u8, 32, 64, 96, 127];
        let out = apply(&input, VelocityCurve::Exponential, 1.0);
        assert_eq!(out[0], 1);
        assert_eq!(*out.last().unwrap(), 127);
        assert!(out[1] < 32);
        assert!(out[2] < 64);
        // Monotonic, so the drawing never folds back on itself.
        assert!(out.windows(2).all(|w| w[0] <= w[1]));
    }

    #[test]
    fn logarithmic_lifts_the_middle() {
        let out = apply(&[0, 64, 127], VelocityCurve::Logarithmic, 1.0);
        assert!(out[1] > 64);
        assert!(out.iter().all(|v| (1..=127).contains(v)));
    }

    #[test]
    fn compress_narrows_the_range_and_scurve_softens_the_ends() {
        let input = [1u8, 64, 127];
        let compressed = apply(&input, VelocityCurve::Compress, 1.0);
        assert!(compressed[0] > 1 && compressed[2] < 127);
        let s = apply(&input, VelocityCurve::SCurve, 1.0);
        assert_eq!(s[1], 64);
        assert!(s[0] <= 1 && *s.last().unwrap() >= 127);
    }

    #[test]
    fn parsing_defaults_to_linear() {
        assert_eq!(VelocityCurve::parse("exp"), VelocityCurve::Exponential);
        assert_eq!(VelocityCurve::parse("nonsense"), VelocityCurve::Linear);
        assert!(apply(&[], VelocityCurve::Linear, 1.0).is_empty());
    }
}
