//! Tauri commands for VST3/CLAP hosting.
//!
//! Every call goes through the plughost helper process, so plugin crashes are
//! contained and reported instead of taking the studio down.

use std::path::PathBuf;
use std::sync::Mutex;

use openbeats_plugins::{host_support, PluginCandidate, PluginHost};
use tauri::State;

pub struct PluginState {
    host: Mutex<PluginHost>,
}

impl PluginState {
    pub fn new(helper: PathBuf, cache: PathBuf) -> Self {
        Self {
            host: Mutex::new(PluginHost::new(helper, cache)),
        }
    }
}

fn lock<'a>(
    state: &'a State<'_, PluginState>,
) -> Result<std::sync::MutexGuard<'a, PluginHost>, String> {
    state
        .host
        .lock()
        .map_err(|_| "the plugin host is unavailable".to_string())
}

/// Scans installed VST3/CLAP bundles without loading plugin code.
#[tauri::command]
pub fn scan_plugins(state: State<'_, PluginState>) -> Result<Vec<PluginCandidate>, String> {
    lock(&state)?.scan()
}

/// Loads the chosen scan results into a chain in a fresh helper process.
#[tauri::command]
pub fn load_plugin_chain(
    state: State<'_, PluginState>,
    indices: Vec<usize>,
    sample_rate: Option<f64>,
    block_size: Option<usize>,
) -> Result<usize, String> {
    lock(&state)?.open_chain(
        &indices,
        sample_rate.unwrap_or(48_000.0),
        block_size.unwrap_or(512),
    )
}

#[tauri::command]
pub fn unload_plugin_chain(state: State<'_, PluginState>) -> Result<(), String> {
    lock(&state)?.unload();
    Ok(())
}

/// Recovers a crashed chain in a new helper so the session keeps running.
#[tauri::command]
pub fn recover_plugin_chain(state: State<'_, PluginState>) -> Result<(), String> {
    lock(&state)?.recover()
}

#[tauri::command]
pub fn plugin_host_support() -> String {
    host_support().to_string()
}
