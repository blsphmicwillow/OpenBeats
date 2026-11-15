//! Allocation-free callback execution of a [`MixerGraph`].
//!
//! The graph is resolved once when playback starts. The audio callback only
//! reads the precomputed order, destinations and sends, then reuses its own
//! sum/output buffers.

use crate::mixer::MixerGraph;
use crate::plugin::PluginProcessor;

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
    inputs: Vec<Vec<usize>>,
    destinations: Vec<Option<usize>>,
    sends: Vec<Vec<RuntimeSend>>,
    plugins: Vec<Option<PluginProcessor>>,
    delays: Vec<DelayLine>,
    sums: Vec<(f32, f32)>,
    outputs: Vec<(f32, f32)>,
    master: Option<usize>,
    soloing: bool,
}

impl MixerRuntime {
    /// Builds the callback plan. Returns `None` for an empty or invalid graph,
    /// in which case the caller falls back to summing channels directly.
    pub fn new(graph: &MixerGraph, channel_mixers: &[usize]) -> Option<Self> {
        Self::new_with_plugins(graph, channel_mixers, Vec::new())
    }

    /// Builds the callback plan with already-prepared plugin instances.
    pub fn new_with_plugins(
        graph: &MixerGraph,
        channel_mixers: &[usize],
        plugin_inserts: Vec<(usize, PluginProcessor)>,
    ) -> Option<Self> {
        if graph.strips.is_empty() {
            return None;
        }
        let order_ids = graph.order().ok()?;
        let index_of = |id: usize| graph.strips.iter().position(|strip| strip.id == id);

        let order: Vec<usize> = order_ids
            .iter()
            .map(|id| index_of(*id))
            .collect::<Option<_>>()?;
        let mut inputs = vec![Vec::new(); graph.strips.len()];
        for (channel, mixer) in channel_mixers.iter().enumerate() {
            let index = index_of(*mixer)?;
            inputs[index].push(channel);
        }

        let mut plugins = (0..graph.strips.len()).map(|_| None).collect::<Vec<_>>();
        let mut max_plugin_latency = 0u64;
        for (strip_id, plugin) in plugin_inserts {
            let index = index_of(strip_id)?;
            if plugins[index].is_some() {
                return None;
            }
            max_plugin_latency = max_plugin_latency.max(plugin.latency_frames());
            plugins[index] = Some(plugin);
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

        let delays = plugins
            .iter()
            .zip(&inputs)
            .map(|(plugin, inputs)| {
                let frames = match plugin {
                    Some(plugin) => max_plugin_latency.saturating_sub(plugin.latency_frames()),
                    None if !inputs.is_empty() => max_plugin_latency,
                    None => 0,
                };
                DelayLine::new(frames as usize)
            })
            .collect();

        Some(Self {
            strips: graph.strips.clone(),
            order,
            inputs,
            destinations,
            sends,
            plugins,
            delays,
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
            let source = self.inputs[index].iter().fold((0.0, 0.0), |sum, input| {
                let frame = channels.get(*input).copied().unwrap_or((0.0, 0.0));
                (sum.0 + frame.0, sum.1 + frame.1)
            });
            let sum = self.sums[index];
            let mut dry = (source.0 + sum.0, source.1 + sum.1);
            if let Some(plugin) = self.plugins[index].as_mut() {
                dry = plugin.process(dry.0, dry.1);
            }
            dry = self.delays[index].process(dry);
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

    pub fn failed_plugins(&self) -> usize {
        self.plugins
            .iter()
            .filter(|plugin| plugin.as_ref().is_some_and(PluginProcessor::is_failed))
            .count()
    }

    pub fn failed_plugin_strips(&self) -> impl Iterator<Item = usize> + '_ {
        self.plugins
            .iter()
            .enumerate()
            .filter_map(|(index, plugin)| {
                plugin
                    .as_ref()
                    .filter(|processor| processor.is_failed())
                    .map(|_| self.strips[index].id)
            })
    }
}

struct DelayLine {
    buffer: Vec<(f32, f32)>,
    index: usize,
    frames: usize,
}

impl DelayLine {
    fn new(frames: usize) -> Self {
        Self {
            buffer: vec![(0.0, 0.0); frames.saturating_add(1).max(1)],
            index: 0,
            frames,
        }
    }

    fn process(&mut self, input: (f32, f32)) -> (f32, f32) {
        if self.frames == 0 {
            return input;
        }
        self.buffer[self.index] = input;
        let read = (self.index + self.buffer.len() - self.frames) % self.buffer.len();
        let output = self.buffer[read];
        self.index = (self.index + 1) % self.buffer.len();
        output
    }
}

#[cfg(test)]
mod tests {
    use std::alloc::{GlobalAlloc, Layout, System};
    use std::cell::Cell;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::thread;
    use std::time::Duration;

    use super::*;
    use crate::mixer::{MixerStrip, Send};
    use crate::plugin::PluginProcessor;

    thread_local! {
        static IN_REALTIME_PROCESS: Cell<bool> = const { Cell::new(false) };
    }

    static REALTIME_ALLOCATIONS: AtomicUsize = AtomicUsize::new(0);

    struct RealtimeCountingAllocator;

    unsafe impl GlobalAlloc for RealtimeCountingAllocator {
        unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
            IN_REALTIME_PROCESS
                .try_with(|enabled| {
                    if enabled.get() {
                        REALTIME_ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
                    }
                })
                .ok();
            unsafe { System.alloc(layout) }
        }

        unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
            IN_REALTIME_PROCESS
                .try_with(|enabled| {
                    if enabled.get() {
                        REALTIME_ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
                    }
                })
                .ok();
            unsafe { System.alloc_zeroed(layout) }
        }

        unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, size: usize) -> *mut u8 {
            IN_REALTIME_PROCESS
                .try_with(|enabled| {
                    if enabled.get() {
                        REALTIME_ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
                    }
                })
                .ok();
            unsafe { System.realloc(pointer, layout, size) }
        }

        unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
            unsafe { System.dealloc(pointer, layout) }
        }
    }

    #[global_allocator]
    static ALLOCATOR: RealtimeCountingAllocator = RealtimeCountingAllocator;

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

    #[test]
    fn plugin_insert_is_audible_and_other_strips_match_its_latency() {
        let mut graph = graph();
        graph.strips[1].gain = 1.0;
        graph.strips[2].gain = 1.0;
        let (processor, mut worker) = PluginProcessor::pair(16, 0);
        worker.mark_ready();
        let mut runtime =
            MixerRuntime::new_with_plugins(&graph, &[1, 2], vec![(1, processor)]).unwrap();

        for sequence in 0..96 {
            let input = sequence as f32;
            let output = runtime.process(&[(input, input), (input, input)]);
            while let Some(mut frame) = worker.try_pop_input() {
                frame.left *= 0.5;
                frame.right *= 0.5;
                assert!(worker.try_push_output(frame));
            }
            if sequence >= 32 {
                let expected = (sequence - 32) as f32 * 1.5;
                assert_eq!(output, (expected, expected));
            }
        }
    }

    #[test]
    fn callback_processing_with_a_plugin_insert_does_not_allocate() {
        let mut graph = graph();
        graph.strips[1].gain = 1.0;
        graph.strips[2].gain = 1.0;
        let (processor, mut worker) = PluginProcessor::pair(16, 0);
        worker.mark_ready();
        let mut runtime =
            MixerRuntime::new_with_plugins(&graph, &[1, 2], vec![(1, processor)]).unwrap();
        let channels = [(0.1, 0.1), (0.2, 0.2)];
        REALTIME_ALLOCATIONS.store(0, Ordering::Relaxed);

        IN_REALTIME_PROCESS.with(|enabled| enabled.set(true));
        for _ in 0..128 {
            runtime.process(&channels);
            while let Some(frame) = worker.try_pop_input() {
                assert!(worker.try_push_output(frame));
            }
        }
        IN_REALTIME_PROCESS.with(|enabled| enabled.set(false));

        assert_eq!(
            REALTIME_ALLOCATIONS.load(Ordering::Relaxed),
            0,
            "MixerRuntime::process allocated with a CLAP insert present"
        );
    }

    #[test]
    fn nonzero_plugin_latency_keeps_insert_and_dry_strips_aligned() {
        let mut graph = graph();
        graph.strips[1].gain = 1.0;
        graph.strips[2].gain = 1.0;
        let (processor, mut worker) = PluginProcessor::pair(16, 5);
        worker.mark_ready();
        let mut runtime =
            MixerRuntime::new_with_plugins(&graph, &[1, 2], vec![(1, processor)]).unwrap();
        let mut plugin_delay = [(0.0, 0.0); 5];
        let mut plugin_delay_index = 0;

        for sequence in 0..128 {
            let input = sequence as f32;
            let output = runtime.process(&[(input, input), (input, input)]);
            while let Some(frame) = worker.try_pop_input() {
                let delayed = plugin_delay[plugin_delay_index];
                plugin_delay[plugin_delay_index] = (frame.left, frame.right);
                plugin_delay_index = (plugin_delay_index + 1) % plugin_delay.len();
                assert!(worker.try_push_output(crate::plugin::AudioFrame {
                    sequence: frame.sequence,
                    left: delayed.0 * 0.5,
                    right: delayed.1 * 0.5,
                }));
            }
            if sequence >= 37 {
                let expected = (sequence - 37) as f32 * 1.5;
                assert_eq!(output, (expected, expected));
            }
        }
    }

    #[test]
    fn failed_plugin_status_identifies_its_mixer_strip() {
        let (processor, worker) = PluginProcessor::pair(16, 0);
        let runtime =
            MixerRuntime::new_with_plugins(&graph(), &[1, 2], vec![(1, processor)]).unwrap();
        worker.mark_failed();
        assert_eq!(runtime.failed_plugin_strips().collect::<Vec<_>>(), vec![1]);
    }

    #[test]
    fn plugin_insert_processes_audio_routed_to_a_bus_without_direct_channels() {
        let mut graph = graph();
        graph.strips[1].route = Some(2);
        graph.strips[2].gain = 1.0;
        let (processor, mut worker) = PluginProcessor::pair(16, 0);
        worker.mark_ready();
        let mut runtime =
            MixerRuntime::new_with_plugins(&graph, &[1], vec![(2, processor)]).unwrap();

        for sequence in 0..128 {
            let input = sequence as f32;
            let output = runtime.process(&[(input, input)]);
            while let Some(mut frame) = worker.try_pop_input() {
                frame.left *= 0.5;
                frame.right *= 0.5;
                assert!(worker.try_push_output(frame));
            }
            if sequence >= 64 {
                let expected = (sequence - 64) as f32 * 0.25;
                assert_eq!(output, (expected, expected));
            }
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn real_clap_insert_is_audible_through_the_mixer_runtime() {
        use std::path::Path;

        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
        let helper = std::env::var_os("OPENBEATS_CLAP_HELPER")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| {
                root.join("src-tauri").join("binaries").join(format!(
                    "openbeats-clap-helper-{}-unknown-linux-gnu",
                    std::env::consts::ARCH
                ))
            });
        let fixture = root
            .join("plugins")
            .join("openbeats-gain")
            .join("dist")
            .join("OpenBeatsGain.clap");
        if !helper.is_file() || !fixture.is_file() {
            eprintln!("SKIP: build OpenBeats Gain and the CLAP helper first");
            return;
        }

        let plugin_id = "studio.openbeats.gain";
        let gain = PluginProcessor::probe(&helper, plugin_id)
            .expect("the proof CLAP plugin should load")
            .into_iter()
            .find(|parameter| parameter.name == "Gain")
            .expect("OpenBeats Gain exposes a Gain parameter");
        let processor = PluginProcessor::launch(
            &helper,
            plugin_id,
            48_000.0,
            crate::plugin::DEFAULT_PLUGIN_QUANTUM,
            None,
        )
        .expect("the proof plugin should load for mixer processing");
        processor
            .set_parameter(gain.id, 0.25)
            .expect("queue the plugin gain before playback");

        let mut graph = graph();
        graph.strips[1].gain = 1.0;
        graph.strips[2].gain = 1.0;
        let mut runtime =
            MixerRuntime::new_with_plugins(&graph, &[1, 2], vec![(1, processor)]).unwrap();
        let mut rendered = Vec::new();
        let block_duration =
            Duration::from_secs_f64(crate::plugin::DEFAULT_PLUGIN_QUANTUM as f64 / 48_000.0);
        for _ in 0..32 {
            for _ in 0..crate::plugin::DEFAULT_PLUGIN_QUANTUM {
                rendered.push(runtime.process(&[(0.1, 0.1), (0.1, 0.1)]).0);
            }
            thread::sleep(block_duration);
        }

        let tail = &rendered[rendered.len() - 2048..];
        let rms =
            (tail.iter().map(|sample| sample * sample).sum::<f32>() / tail.len() as f32).sqrt();
        assert!(
            (0.1..0.12).contains(&rms),
            "CLAP insert and latency-matched dry strip should sum, got RMS {rms}"
        );
    }
}
