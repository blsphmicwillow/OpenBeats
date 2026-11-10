//! Mixer routing: strips, multiple send destinations, insert order and
//! sidechain ducking.
//!
//! Modelled on FL Studio's mixer: every strip feeds exactly one destination
//! (the master by default) and may additionally send to any number of others,
//! pre or post fader. Routing is resolved to a topological order so a strip is
//! always mixed after everything that feeds it, and routing cycles are rejected
//! instead of silently producing garbage.

use serde::{Deserialize, Serialize};

/// One additional destination for a strip.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
pub struct Send {
    pub to: usize,
    /// Linear amount, 0..=1 normally, but summing sends are allowed above.
    pub amount: f32,
    /// Pre-fader sends ignore the strip gain and mute.
    #[serde(default)]
    pub pre_fader: bool,
}

impl Send {
    pub fn new(to: usize, amount: f32) -> Self {
        Self {
            to,
            amount,
            pre_fader: false,
        }
    }

    pub fn pre_fader(to: usize, amount: f32) -> Self {
        Self {
            to,
            amount,
            pre_fader: true,
        }
    }
}

/// A mixer strip.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct MixerStrip {
    pub id: usize,
    #[serde(default = "unity")]
    pub gain: f32,
    #[serde(default)]
    pub mute: bool,
    #[serde(default)]
    pub solo: bool,
    /// Main destination; `None` means the master.
    #[serde(default)]
    pub route: Option<usize>,
    #[serde(default)]
    pub sends: Vec<Send>,
    /// Strip whose signal ducks this one (sidechain input).
    #[serde(default)]
    pub sidechain: Option<usize>,
}

fn unity() -> f32 {
    1.0
}

impl MixerStrip {
    pub fn new(id: usize) -> Self {
        Self {
            id,
            gain: 1.0,
            mute: false,
            solo: false,
            route: None,
            sends: Vec::new(),
            sidechain: None,
        }
    }
}

/// A routing problem the engine must refuse to run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MixError {
    /// A send or route points at a strip that does not exist.
    UnknownStrip(usize),
    /// Routing loops back on itself.
    Cycle(Vec<usize>),
    /// The graph has no strips.
    Empty,
}

impl std::fmt::Display for MixError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MixError::UnknownStrip(id) => write!(f, "mixer strip {id} does not exist"),
            MixError::Cycle(ids) => write!(f, "mixer routing cycle: {ids:?}"),
            MixError::Empty => write!(f, "the mixer has no strips"),
        }
    }
}

/// The mixer graph.
#[derive(Debug, Clone, Default, PartialEq, Deserialize, Serialize)]
pub struct MixerGraph {
    pub strips: Vec<MixerStrip>,
}

impl MixerGraph {
    pub fn new(strips: Vec<MixerStrip>) -> Self {
        Self { strips }
    }

    fn index_of(&self, id: usize) -> Option<usize> {
        self.strips.iter().position(|s| s.id == id)
    }

    /// Destination of a strip, defaulting to the master (id 0).
    fn destination(&self, strip: &MixerStrip) -> usize {
        strip.route.unwrap_or(0)
    }

    /// Mixing order: every strip appears after the strips that feed it.
    ///
    /// The master (id 0) is always last so its sum is complete.
    pub fn order(&self) -> Result<Vec<usize>, MixError> {
        if self.strips.is_empty() {
            return Err(MixError::Empty);
        }
        let count = self.strips.len();
        let mut indegree = vec![0usize; count];
        let mut edges: Vec<Vec<usize>> = vec![Vec::new(); count];

        for (from, strip) in self.strips.iter().enumerate() {
            let destination = self.destination(strip);
            let mut targets = Vec::new();
            if destination == strip.id {
                // The master routing to itself is its definition; any other
                // strip feeding itself is a real loop.
                if strip.id != 0 {
                    return Err(MixError::Cycle(vec![strip.id]));
                }
            } else {
                targets.push(destination);
            }
            targets.extend(strip.sends.iter().map(|send| send.to));
            for target in targets {
                let Some(to) = self.index_of(target) else {
                    return Err(MixError::UnknownStrip(target));
                };
                if to == from {
                    // A strip feeding itself is a cycle of one.
                    return Err(MixError::Cycle(vec![strip.id]));
                }
                edges[from].push(to);
                indegree[to] += 1;
            }
        }

        let mut queue: Vec<usize> = (0..count).filter(|i| indegree[*i] == 0).collect();
        queue.sort_by_key(|i| self.strips[*i].id);
        let mut order = Vec::with_capacity(count);
        while let Some(node) = queue.pop() {
            order.push(self.strips[node].id);
            let mut next = Vec::new();
            for to in &edges[node] {
                indegree[*to] -= 1;
                if indegree[*to] == 0 {
                    next.push(*to);
                }
            }
            next.sort_by_key(|i| self.strips[*i].id);
            queue.extend(next.into_iter().rev());
        }

        if order.len() != count {
            let stuck: Vec<usize> = (0..count)
                .filter(|i| !order.contains(&self.strips[*i].id))
                .map(|i| self.strips[i].id)
                .collect();
            return Err(MixError::Cycle(stuck));
        }
        // Master last, so nothing is mixed into it after it has been read.
        if let Some(pos) = order.iter().position(|id| *id == 0) {
            let master = order.remove(pos);
            order.push(master);
        }
        Ok(order)
    }

    fn any_solo(&self) -> bool {
        self.strips.iter().any(|s| s.solo)
    }

    /// Mixes one frame per strip.
    ///
    /// `inputs` holds the source signal for each strip in `strips` order.
    /// Returns the master output and every strip's post-fader output.
    pub fn render(&self, inputs: &[(f32, f32)]) -> Result<(Vec<(f32, f32)>, (f32, f32)), MixError> {
        let order = self.order()?;
        let count = self.strips.len();
        let mut sums = vec![(0.0f32, 0.0f32); count];
        let mut outputs = vec![(0.0f32, 0.0f32); count];
        let soloing = self.any_solo();

        for id in order {
            let index = self.index_of(id).ok_or(MixError::UnknownStrip(id))?;
            let strip = &self.strips[index];
            let (in_l, in_r) = inputs.get(index).copied().unwrap_or((0.0, 0.0));
            let (sum_l, sum_r) = sums[index];
            let dry = (in_l + sum_l, in_r + sum_r);

            let audible = !strip.mute && (!soloing || strip.solo || id == 0);
            let gain = if audible { strip.gain.max(0.0) } else { 0.0 };
            let out = (dry.0 * gain, dry.1 * gain);
            outputs[index] = out;

            // Post-fader send, and the main route, both carry the strip output.
            for send in &strip.sends {
                let Some(to) = self.index_of(send.to) else {
                    return Err(MixError::UnknownStrip(send.to));
                };
                let amount = send.amount.max(0.0);
                let source = if send.pre_fader { dry } else { out };
                sums[to].0 += source.0 * amount;
                sums[to].1 += source.1 * amount;
            }

            let target = self.destination(strip);
            let Some(to) = self.index_of(target) else {
                return Err(MixError::UnknownStrip(target));
            };
            if to != index {
                sums[to].0 += out.0;
                sums[to].1 += out.1;
            }
        }

        let master = self
            .index_of(0)
            .map(|i| outputs[i])
            .unwrap_or((sums[0].0, sums[0].1));
        Ok((outputs, master))
    }
}

fn db_to_gain(db: f32) -> f32 {
    10f32.powf(db / 20.0)
}

/// Sidechain ducker: attenuates its input by how far the key signal is over the
/// threshold.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Sidechain {
    sample_rate: f32,
    threshold_db: f32,
    ratio: f32,
    /// Gain reduction is smoothed with these two coefficients.
    attack_coef: f32,
    release_coef: f32,
    envelope: f32,
    reduction: f32,
}

impl Sidechain {
    pub fn new(sample_rate: f32) -> Self {
        let mut sc = Self {
            sample_rate,
            threshold_db: -24.0,
            ratio: 4.0,
            attack_coef: 0.0,
            release_coef: 0.0,
            envelope: 0.0,
            reduction: 1.0,
        };
        sc.set_params(-24.0, 4.0, 0.005, 0.15);
        sc
    }

    pub fn set_params(&mut self, threshold_db: f32, ratio: f32, attack: f32, release: f32) {
        self.threshold_db = threshold_db;
        self.ratio = ratio.max(1.0);
        let coef = |seconds: f32| (-1.0 / (self.sample_rate * seconds.max(1e-4))).exp();
        self.attack_coef = coef(attack);
        self.release_coef = coef(release);
    }

    /// Applies ducking to `input`, driven by the `key` signal's level.
    pub fn process(&mut self, input: (f32, f32), key: f32) -> (f32, f32) {
        let rectified = key.abs();
        let coef = if rectified > self.envelope {
            self.attack_coef
        } else {
            self.release_coef
        };
        self.envelope = coef * self.envelope + (1.0 - coef) * rectified;

        let level_db = 20.0 * self.envelope.max(1e-9).log10();
        let over = (level_db - self.threshold_db).max(0.0);
        let target = db_to_gain(-over * (1.0 - 1.0 / self.ratio));
        self.reduction = if target < self.reduction {
            self.attack_coef * self.reduction + (1.0 - self.attack_coef) * target
        } else {
            self.release_coef * self.reduction + (1.0 - self.release_coef) * target
        };
        (input.0 * self.reduction, input.1 * self.reduction)
    }

    /// Current linear gain reduction, 1.0 when not ducking.
    pub fn reduction(&self) -> f32 {
        self.reduction
    }

    pub fn reset(&mut self) {
        self.envelope = 0.0;
        self.reduction = 1.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strips() -> Vec<MixerStrip> {
        let mut master = MixerStrip::new(0);
        master.gain = 1.0;
        let mut drums = MixerStrip::new(1);
        drums.gain = 0.5;
        let mut verb = MixerStrip::new(2);
        verb.gain = 1.0;
        vec![master, drums, verb]
    }

    #[test]
    fn strip_routes_into_the_master() {
        let graph = MixerGraph::new(strips());
        let (_, master) = graph.render(&[(0.0, 0.0), (0.5, 0.5), (0.0, 0.0)]).unwrap();
        // Drums: 0.5 in × 0.5 gain = 0.25, summed into the master.
        assert!((master.0 - 0.25).abs() < 1e-6, "master was {master:?}");
    }

    #[test]
    fn a_strip_can_send_to_several_destinations() {
        let mut s = strips();
        s[1].sends = vec![Send::new(2, 0.5), Send::new(0, 0.25)];
        let graph = MixerGraph::new(s);
        let (outputs, master) = graph.render(&[(0.0, 0.0), (1.0, 1.0), (0.0, 0.0)]).unwrap();
        // Drums output 0.5; send 0.25 to master and 0.5 to the reverb strip,
        // which then routes its own output to the master.
        assert!(
            (outputs[2].0 - 0.25).abs() < 1e-6,
            "reverb got {:?}",
            outputs[2]
        );
        // 0.125 direct send + 0.5 main route + 0.25 from the reverb strip.
        assert!((master.0 - 0.875).abs() < 1e-6, "master was {master:?}");
    }

    #[test]
    fn pre_fader_sends_ignore_mute() {
        let mut s = strips();
        s[1].mute = true;
        s[1].sends = vec![Send::pre_fader(2, 1.0)];
        let graph = MixerGraph::new(s);
        let (outputs, _) = graph.render(&[(0.0, 0.0), (1.0, 1.0), (0.0, 0.0)]).unwrap();
        assert_eq!(outputs[1], (0.0, 0.0), "muted strip still output audio");
        assert!(outputs[2].0 > 0.0, "pre-fader send was muted");
    }

    #[test]
    fn solo_silences_every_other_strip() {
        let mut s = strips();
        s[2].solo = true;
        s[1].route = Some(0);
        let graph = MixerGraph::new(s);
        let (outputs, _) = graph.render(&[(0.0, 0.0), (1.0, 1.0), (1.0, 1.0)]).unwrap();
        assert_eq!(outputs[1], (0.0, 0.0), "non-soloed strip leaked");
        assert!(outputs[2].0 > 0.0);
    }

    #[test]
    fn a_routing_cycle_is_rejected() {
        let mut s = strips();
        s[1].route = Some(2);
        s[2].route = Some(1);
        let graph = MixerGraph::new(s);
        assert!(matches!(graph.order(), Err(MixError::Cycle(_))));
        assert!(graph.render(&[(0.0, 0.0); 3]).is_err());
    }

    #[test]
    fn unknown_destinations_are_rejected() {
        let mut s = strips();
        s[1].route = Some(99);
        let graph = MixerGraph::new(s);
        assert_eq!(graph.order(), Err(MixError::UnknownStrip(99)));
    }

    #[test]
    fn an_empty_mixer_is_rejected() {
        assert_eq!(MixerGraph::default().order(), Err(MixError::Empty));
    }

    #[test]
    fn order_places_sources_before_their_destination() {
        let mut s = strips();
        s[1].route = Some(2);
        let graph = MixerGraph::new(s);
        let order = graph.order().unwrap();
        let drums = order.iter().position(|id| *id == 1).unwrap();
        let target = order.iter().position(|id| *id == 2).unwrap();
        assert!(drums < target, "order was {order:?}");
        assert_eq!(*order.last().unwrap(), 0, "master was not last");
    }

    #[test]
    fn sidechain_ducks_the_input_when_the_key_is_loud() {
        let mut sc = Sidechain::new(48_000.0);
        sc.set_params(-30.0, 8.0, 0.001, 0.05);
        let mut reduced = 1.0f32;
        for _ in 0..4_800 {
            sc.process((1.0, 1.0), 1.0);
            reduced = sc.reduction();
        }
        assert!(reduced < 0.5, "key did not duck: {reduced}");
    }

    #[test]
    fn sidechain_releases_when_the_key_stops() {
        let mut sc = Sidechain::new(48_000.0);
        sc.set_params(-30.0, 8.0, 0.001, 0.02);
        for _ in 0..4_800 {
            sc.process((1.0, 1.0), 1.0);
        }
        for _ in 0..24_000 {
            sc.process((0.0, 0.0), 0.0);
        }
        assert!(
            sc.reduction() > 0.95,
            "sidechain never released: {}",
            sc.reduction()
        );
    }

    #[test]
    fn sidechain_leaves_quiet_input_alone() {
        let mut sc = Sidechain::new(48_000.0);
        sc.set_params(-30.0, 8.0, 0.001, 0.05);
        for _ in 0..4_800 {
            sc.process((0.3, 0.3), 0.001);
        }
        let out = sc.process((0.3, 0.3), 0.001);
        assert!(
            (out.0 - 0.3).abs() < 1e-3,
            "quiet input was ducked: {out:?}"
        );
    }
}
