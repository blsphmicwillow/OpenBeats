//! Real plugin hosting (Windows, macOS) built on plughost 0.2.1.
//!
//! Plugin code never runs in the application process: `plughost` starts the
//! `plughost-helper` binary, one short-lived process per bundle scan and one
//! long-lived process per chain. A plugin that crashes or hangs takes only its
//! helper down, and [`PluginHost::recover`] rebuilds the chain in a new helper.

use std::path::{Path, PathBuf};

use plughost::{
    BlockContext, Chain, ChainSlot, Events, Layout, PluginRef, Process, RealtimeConfig,
    RealtimeEndpoint, Scanner, SpawnOptions,
};
use serde::Serialize;

/// One discovered plugin class, shaped for the React plugin browser.
#[derive(Debug, Clone, Serialize)]
pub struct PluginCandidate {
    pub name: String,
    pub vendor: String,
    pub version: String,
    /// "Instrument" or "Effect".
    pub kind: String,
    pub categories: Vec<String>,
    /// Stable identifier for the UI; the class id from the format.
    pub id: String,
    /// True when this platform can host the format.
    pub hostable: bool,
}

/// Where the helper binary lives, and the chain currently loaded.
pub struct PluginHost {
    helper: PathBuf,
    cache: PathBuf,
    catalog: Vec<PluginRef>,
    chain: Option<LoadedChain>,
}

struct LoadedChain {
    chain: Chain,
    slots: Vec<ChainSlot>,
    sample_rate: f64,
    block_size: usize,
    endpoint: Option<RealtimeEndpoint>,
}

impl PluginHost {
    pub fn new(helper: impl Into<PathBuf>, cache: impl Into<PathBuf>) -> Self {
        Self {
            helper: helper.into(),
            cache: cache.into(),
            catalog: Vec::new(),
            chain: None,
        }
    }

    /// Finds the helper next to the app binary, or through an override.
    pub fn helper_path(app_dir: Option<&Path>) -> PathBuf {
        if let Ok(path) = std::env::var("OPENBEATS_PLUGHOST_HELPER") {
            if !path.is_empty() {
                return PathBuf::from(path);
            }
        }
        let exe = if cfg!(windows) {
            "plughost-helper.exe"
        } else {
            "plughost-helper"
        };
        if let Some(dir) = app_dir {
            let candidate = dir.join(exe);
            if candidate.exists() {
                return candidate;
            }
        }
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("target")
            .join(if cfg!(debug_assertions) {
                "debug"
            } else {
                "release"
            })
            .join(exe)
    }

    pub fn helper(&self) -> &Path {
        &self.helper
    }

    /// Discovers installed VST3/CLAP bundles without loading plugin code.
    pub fn scan(&mut self) -> Result<Vec<PluginCandidate>, String> {
        if !self.helper.exists() {
            return Err(format!(
                "the plugin helper is missing at {} — rebuild the workspace so plughost-helper is produced",
                self.helper.display()
            ));
        }
        let scanner = Scanner::new(&self.helper, &self.cache);
        let catalog = scanner.discover();

        let mut candidates = Vec::new();
        let mut refs = Vec::new();
        for (plugin, info) in catalog.plugins() {
            candidates.push(PluginCandidate {
                name: info.name.clone(),
                vendor: info.vendor.clone(),
                version: info.version.clone(),
                kind: format!("{:?}", info.kind),
                categories: info.categories.clone(),
                id: format!("{:?}", info.id),
                hostable: true,
            });
            refs.push(plugin);
        }
        self.catalog = refs;
        Ok(candidates)
    }

    /// Loads a chain from the last scan into a fresh helper process.
    pub fn open_chain(
        &mut self,
        indices: &[usize],
        sample_rate: f64,
        block_size: usize,
    ) -> Result<usize, String> {
        let slots: Vec<ChainSlot> = indices
            .iter()
            .map(|index| {
                self.catalog
                    .get(*index)
                    .map(|plugin| ChainSlot::new(plugin.clone()))
                    .ok_or_else(|| format!("plugin {index} is not in the last scan"))
            })
            .collect::<Result<_, _>>()?;
        if slots.is_empty() {
            self.chain = None;
            return Ok(0);
        }

        let mut chain = Chain::spawn(&self.helper, &slots, &SpawnOptions::default())
            .map_err(|e| format!("could not load the plugin chain: {e}"))?;
        let config = chain
            .main_bus_config(sample_rate, block_size, Layout::Stereo, &[Layout::Stereo])
            .map_err(|e| format!("could not configure plugin audio: {e}"))?;
        chain
            .prepare_audio(&config)
            .map_err(|e| format!("could not prepare plugin audio: {e}"))?;

        let count = slots.len();
        self.chain = Some(LoadedChain {
            chain,
            slots,
            sample_rate,
            block_size,
            endpoint: None,
        });
        Ok(count)
    }

    /// Builds the lock-free realtime endpoint for the loaded chain.
    pub fn realtime_endpoint(&mut self, quantum: usize) -> Result<u32, String> {
        let loaded = self
            .chain
            .as_mut()
            .ok_or_else(|| "no plugin chain is loaded".to_string())?;
        let quantum = quantum.clamp(16, loaded.block_size.max(16));
        let endpoint = loaded
            .chain
            .realtime_endpoint(&RealtimeConfig::new(quantum))
            .map_err(|e| format!("could not create the realtime endpoint: {e}"))?;
        let latency = loaded.chain.latency();
        loaded.endpoint = Some(endpoint);
        Ok(latency)
    }

    /// Processes one stereo block offline (bounce, tests and the fallback path).
    pub fn process_block(&mut self, left: &mut [f32], right: &mut [f32]) -> Result<(), String> {
        let loaded = self
            .chain
            .as_mut()
            .ok_or_else(|| "no plugin chain is loaded".to_string())?;
        let frames = left.len().min(right.len());
        if frames == 0 {
            return Ok(());
        }
        let context = BlockContext::new(frames);
        let mut produced = Events::for_block();
        let input: [&[f32]; 2] = [&left[..frames], &right[..frames]];
        let mut output_left = vec![0.0f32; frames];
        let mut output_right = vec![0.0f32; frames];
        {
            let mut output: [&mut [f32]; 2] = [&mut output_left, &mut output_right];
            loaded
                .chain
                .process(
                    &context,
                    &input,
                    &mut output,
                    &[],
                    &Events::new(),
                    &mut produced,
                )
                .map_err(describe)?;
        }
        left[..frames].copy_from_slice(&output_left);
        right[..frames].copy_from_slice(&output_right);
        Ok(())
    }

    /// The endpoint the audio callback should own, if one was created.
    pub fn take_endpoint(&mut self) -> Option<RealtimeEndpoint> {
        self.chain
            .as_mut()
            .and_then(|loaded| loaded.endpoint.take())
    }

    /// After a plugin crash: rebuild the chain in a fresh helper from the same
    /// plugins, so the session keeps working and the UI can report what died.
    pub fn recover(&mut self) -> Result<(), String> {
        let loaded = self
            .chain
            .take()
            .ok_or_else(|| "no plugin chain is loaded".to_string())?;
        let recovered = loaded
            .chain
            .recover(&loaded.slots)
            .map_err(|e| format!("could not recover the plugin chain: {e}"))?;
        self.chain = Some(LoadedChain {
            chain: recovered,
            slots: loaded.slots,
            sample_rate: loaded.sample_rate,
            block_size: loaded.block_size,
            endpoint: None,
        });
        Ok(())
    }

    pub fn unload(&mut self) {
        self.chain = None;
    }

    pub fn is_loaded(&self) -> bool {
        self.chain.is_some()
    }

    pub fn plugin_count(&self) -> usize {
        self.chain.as_ref().map(|l| l.slots.len()).unwrap_or(0)
    }
}

/// A stable, user-facing description of a host failure.
fn describe(error: plughost::Error) -> String {
    format!("plugin host error: {error}")
}

/// True when an error means the helper process died or stopped answering.
pub fn is_crash(error: &plughost::Error) -> bool {
    matches!(error.kind(), plughost::FailureKind::Crashed)
}

/// Formats the supported-format matrix for the UI and docs.
pub fn host_support() -> &'static str {
    if cfg!(target_os = "macos") {
        "VST3, CLAP and Audio Units"
    } else {
        "VST3 and CLAP"
    }
}

pub fn candidate_ref_count(host: &PluginHost) -> usize {
    host.catalog.len()
}
