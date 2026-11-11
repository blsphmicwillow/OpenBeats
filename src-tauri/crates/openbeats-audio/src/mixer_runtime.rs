//! Allocation-free callback execution of a [`MixerGraph`].
//!
//! The graph is resolved once when playback starts. The audio callback only
//! reads the precomputed order, destinations and sends, then reuses its own
//! sum/output buffers.

use crate::mixer::MixerGraph;

#[derive(Debug, Clone, Copy)]
struct RuntimeSend {
    to: usize,
    amount: f32,
    pre_fader: bool,
}

/// A resolved mixer graph ready to process one frame at a time.
pub struct MixerRuntime {
    strips: Vec<crate::mixer::MixerStrip>,
    order: Vec<usize>,
    /// Channel-strip index feeding each graph strip; `usize::MAX` means none.
    inputs: Vec<usize>,
    destinations: Vec<Option<usize>>,
    sends: Vec<Vec<RuntimeSend>>,
    sums: Vec<(f32, f32)>,
    outputs: Vec<(f32, f32)>,
    master: Option<usize>,
    soloing: bool,
}

impl MixerRuntime {
    /// Builds the callback plan. Returns `None` for an empty or invalid graph,
    /// in which case the caller falls back to summing channels directly.
    pub fn new(graph: &MixerGraph, channel_mixers: &[usize]) -> Option<Self> {
        if graph.strips.is_empty() {
            return None;
        }
        let order_ids = graph.order().ok()?;
        let index_of = |id: usize| graph.strips.iter().position(|strip| strip.id == id);

        let order: Vec<usize> = order_ids
            .iter()
            .map(|id| index_of(*id))
            .collect::<Option<_>>()?;
        let mut inputs = vec![usize::MAX; graph.strips.len()];
        for index in &order {
            let id = graph.strips[*index].id;
            inputs[*index] = channel_mixers
                .iter()
                .position(|mixer| *mixer == id)
                .unwrap_or(usize::MAX);
        }

        let mut destinations = vec![None; graph.strips.len()];
        let mut sends = vec![Vec::new(); graph.strips.len()];
        for (index, strip) in graph.strips.iter().enumerate() {
            let target = strip.route.unwrap_or(0);
            let to = index_of(target)?;
            if to != index {
                destinations[index] = Some(to);
            }
            sends[index] = strip
                .sends
                .iter()
                .filter_map(|send| {
                    Some(RuntimeSend {
                        to: index_of(send.to)?,
                        amount: send.amount.max(0.0),
                        pre_fader: send.pre_fader,
                    })
                })
                .collect();
        }

        Some(Self {
            strips: graph.strips.clone(),
            order,
            inputs,
            destinations,
            sends,
            sums: vec![(0.0, 0.0); graph.strips.len()],
            outputs: vec![(0.0, 0.0); graph.strips.len()],
            master: index_of(0),
            soloing: graph.strips.iter().any(|strip| strip.solo),
        })
    }

    /// Mixes one frame. `channels` is indexed by the channel-strip order used
    /// to build the runtime, not by mixer-strip ID.
    pub fn process(&mut self, channels: &[(f32, f32)]) -> (f32, f32) {
        self.sums.fill((0.0, 0.0));
        self.outputs.fill((0.0, 0.0));

        for &index in &self.order {
            let strip = &self.strips[index];
            let source = match self.inputs[index] {
                usize::MAX => (0.0, 0.0),
                input => channels.get(input).copied().unwrap_or((0.0, 0.0)),
            };
            let sum = self.sums[index];
            let dry = (source.0 + sum.0, source.1 + sum.1);
            let audible = !strip.mute && (!self.soloing || strip.solo || strip.id == 0);
            let gain = if audible { strip.gain.max(0.0) } else { 0.0 };
            let out = (dry.0 * gain, dry.1 * gain);
            self.outputs[index] = out;

            for send in &self.sends[index] {
                let source = if send.pre_fader { dry } else { out };
                self.sums[send.to].0 += source.0 * send.amount;
                self.sums[send.to].1 += source.1 * send.amount;
            }
            if let Some(to) = self.destinations[index] {
                self.sums[to].0 += out.0;
                self.sums[to].1 += out.1;
            }
        }

        self.master
            .map(|index| self.outputs[index])
            .unwrap_or((0.0, 0.0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mixer::{MixerStrip, Send};

    fn graph() -> MixerGraph {
        let mut master = MixerStrip::new(0);
        master.gain = 1.0;
        let mut drums = MixerStrip::new(1);
        drums.gain = 0.5;
        let mut bus = MixerStrip::new(2);
        bus.gain = 0.5;
        MixerGraph::new(vec![master, drums, bus])
    }

    #[test]
    fn a_strip_gain_only_attenuates_that_strip() {
        let mut runtime = MixerRuntime::new(&graph(), &[1, 2]).unwrap();
        let out = runtime.process(&[(1.0, 1.0), (0.0, 0.0)]);
        assert!((out.0 - 0.5).abs() < 1e-6);
        let out = runtime.process(&[(0.0, 0.0), (1.0, 1.0)]);
        assert!((out.0 - 0.5).abs() < 1e-6);
    }

    #[test]
    fn a_send_reaches_its_bus_without_leaking_into_other_channels() {
        let mut graph = graph();
        graph.strips[1].sends.push(Send::new(2, 0.5));
        let mut runtime = MixerRuntime::new(&graph, &[1, 2]).unwrap();
        let out = runtime.process(&[(1.0, 1.0), (0.0, 0.0)]);
        assert!((out.0 - 0.625).abs() < 1e-6);
    }

    #[test]
    fn mute_and_solo_follow_the_graph() {
        let mut graph = graph();
        graph.strips[2].mute = true;
        let mut runtime = MixerRuntime::new(&graph, &[1, 2]).unwrap();
        assert!((runtime.process(&[(1.0, 1.0), (1.0, 1.0)]).0 - 0.5).abs() < 1e-6);

        graph.strips[1].mute = false;
        graph.strips[1].solo = true;
        graph.strips[2].mute = false;
        let mut runtime = MixerRuntime::new(&graph, &[1, 2]).unwrap();
        assert!((runtime.process(&[(1.0, 1.0), (1.0, 1.0)]).0 - 0.5).abs() < 1e-6);
    }
}
