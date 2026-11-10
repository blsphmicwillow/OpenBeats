//! Linux stub: plughost 0.2.1 does not implement its platform layer on Linux.
//!
//! Nothing pretends to host here. The UI keeps its plugin browser, and every
//! hosting call explains why it cannot proceed.

use std::path::{Path, PathBuf};

use serde::Serialize;

/// Mirrors the real candidate shape so the UI can render the same list.
#[derive(Debug, Clone, Serialize)]
pub struct PluginCandidate {
    pub name: String,
    pub vendor: String,
    pub version: String,
    pub kind: String,
    pub categories: Vec<String>,
    pub id: String,
    pub hostable: bool,
}

pub const UNSUPPORTED_REASON: &str = "VST3/CLAP hosting is unavailable on Linux in this build: \
plughost 0.2.1 does not implement its Linux platform layer. The plugin browser still works.";

/// Keeps the same constructor signature as the real host.
pub struct PluginHost {
    _helper: PathBuf,
    _cache: PathBuf,
}

impl PluginHost {
    pub fn new(helper: impl Into<PathBuf>, cache: impl Into<PathBuf>) -> Self {
        Self {
            _helper: helper.into(),
            _cache: cache.into(),
        }
    }

    pub fn helper_path(_app_dir: Option<&Path>) -> PathBuf {
        PathBuf::new()
    }

    pub fn helper(&self) -> &Path {
        Path::new("")
    }

    pub fn scan(&mut self) -> Result<Vec<PluginCandidate>, String> {
        Err(UNSUPPORTED_REASON.to_string())
    }

    pub fn open_chain(
        &mut self,
        _indices: &[usize],
        _sample_rate: f64,
        _block_size: usize,
    ) -> Result<usize, String> {
        Err(UNSUPPORTED_REASON.to_string())
    }

    pub fn realtime_endpoint(&mut self, _quantum: usize) -> Result<u32, String> {
        Err(UNSUPPORTED_REASON.to_string())
    }

    pub fn process_block(&mut self, _left: &mut [f32], _right: &mut [f32]) -> Result<(), String> {
        Err(UNSUPPORTED_REASON.to_string())
    }

    pub fn recover(&mut self) -> Result<(), String> {
        Err(UNSUPPORTED_REASON.to_string())
    }

    pub fn unload(&mut self) {}

    pub fn is_loaded(&self) -> bool {
        false
    }

    pub fn plugin_count(&self) -> usize {
        0
    }
}

pub fn host_support() -> &'static str {
    "unavailable on Linux (plughost 0.2.1)"
}

pub fn is_crash(_error: &str) -> bool {
    false
}

pub fn candidate_ref_count(_host: &PluginHost) -> usize {
    0
}
