//! Tauri commands for VST3/CLAP hosting.
//!
//! Every call goes through a helper process, so plugin crashes are contained
//! and reported instead of taking the studio down. Windows/macOS keep the
//! existing `plughost` helper; Linux uses the CLAP-only sidecar.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};

#[cfg(target_os = "linux")]
use base64::{engine::general_purpose::STANDARD, Engine as _};
use openbeats_plugins::{host_support, PluginCandidate, PluginHost};
use tauri::State;

#[cfg(target_os = "linux")]
use std::io::{BufRead, BufReader, Write};
#[cfg(target_os = "linux")]
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
#[cfg(target_os = "linux")]
use std::time::Duration;
#[cfg(target_os = "linux")]
use tauri::Manager;

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

/// A CLAP plugin discovered by the Linux sidecar.
#[derive(Debug, Clone, serde::Serialize)]
pub struct LinuxPluginDescriptor {
    pub id: String,
    pub name: String,
    pub vendor: String,
}

/// Lazy owner of the Linux CLAP sidecar. The process is started on the first
/// scan, kept alive for subsequent loads, and killed on drop.
pub struct ClapState {
    #[cfg(target_os = "linux")]
    helper: Arc<Mutex<Option<ClapHelper>>>,
}

impl ClapState {
    pub fn new() -> Self {
        Self {
            #[cfg(target_os = "linux")]
            helper: Arc::new(Mutex::new(None)),
        }
    }
}

impl Default for ClapState {
    fn default() -> Self {
        Self::new()
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

#[derive(serde::Serialize)]
pub struct OfflinePluginAudio {
    pub pcm_base64: String,
    pub latency_frames: u32,
}

/// Processes a stereo offline-rendered strip through an isolated CLAP helper.
#[tauri::command]
pub async fn process_clap_offline(
    app: tauri::AppHandle,
    id: String,
    sample_rate: f32,
    state: Option<Vec<u8>>,
    parameters: HashMap<u32, f64>,
    pcm_base64: String,
) -> Result<OfflinePluginAudio, String> {
    #[cfg(target_os = "linux")]
    {
        let helper = clap_helper_path(&app).ok_or_else(|| {
            format!(
                "openbeats-clap-helper was not found; build a Linux helper and stage it at {}",
                staged_name()
            )
        })?;
        return tauri::async_runtime::spawn_blocking(move || {
            let bytes = STANDARD
                .decode(&pcm_base64)
                .map_err(|error| format!("offline plugin audio was not valid base64: {error}"))?;
            if bytes.len() % 8 != 0 {
                return Err("offline plugin audio must contain stereo f32 frames".to_string());
            }
            let samples: Vec<(f32, f32)> = bytes
                .chunks_exact(8)
                .map(|frame| {
                    (
                        f32::from_le_bytes(frame[..4].try_into().unwrap()),
                        f32::from_le_bytes(frame[4..].try_into().unwrap()),
                    )
                })
                .collect();
            let (rendered, latency_frames) =
                openbeats_audio::plugin::PluginProcessor::process_offline(
                    &helper,
                    &id,
                    sample_rate,
                    state,
                    parameters,
                    &samples,
                )?;
            let mut output = Vec::with_capacity(rendered.len() * 8);
            for (left, right) in rendered {
                output.extend_from_slice(&left.to_le_bytes());
                output.extend_from_slice(&right.to_le_bytes());
            }
            Ok(OfflinePluginAudio {
                pcm_base64: STANDARD.encode(output),
                latency_frames,
            })
        })
        .await
        .map_err(|error| format!("offline plugin processing task failed: {error}"))?;
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, id, sample_rate, state, pcm_base64);
        Err("offline CLAP rendering is currently supported on Linux only".to_string())
    }
}

#[cfg(target_os = "linux")]
struct ClapHelper {
    child: Arc<Mutex<Child>>,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

#[cfg(target_os = "linux")]
struct CommandWatch {
    done: mpsc::SyncSender<()>,
    timed_out: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

#[cfg(target_os = "linux")]
impl CommandWatch {
    fn start(child: Arc<Mutex<Child>>) -> Result<Self, String> {
        let (done, finished) = mpsc::sync_channel(1);
        let timed_out = Arc::new(AtomicBool::new(false));
        let thread_timed_out = Arc::clone(&timed_out);
        let thread = std::thread::Builder::new()
            .name("openbeats-clap-command-watch".to_string())
            .spawn(move || {
                if finished.recv_timeout(Duration::from_secs(10)).is_err() {
                    thread_timed_out.store(true, Ordering::Release);
                    if let Ok(mut child) = child.lock() {
                        if matches!(child.try_wait(), Ok(None)) {
                            let _ = child.kill();
                        }
                    }
                }
            })
            .map_err(|error| format!("could not supervise the CLAP helper: {error}"))?;
        Ok(Self {
            done,
            timed_out,
            thread: Some(thread),
        })
    }

    fn finish(mut self) -> bool {
        let _ = self.done.send(());
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        self.timed_out.load(Ordering::Acquire)
    }
}

#[cfg(target_os = "linux")]
impl ClapHelper {
    fn spawn(app: &tauri::AppHandle) -> Result<Self, String> {
        let path = clap_helper_path(app).ok_or_else(|| {
            format!(
                "openbeats-clap-helper was not found; build a Linux helper and stage it at \
                 {}",
                staged_name()
            )
        })?;
        let mut child = Command::new(&path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("could not start {}: {error}", path.display()))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "the CLAP helper has no stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "the CLAP helper has no stdout".to_string())?;
        Ok(Self {
            child: Arc::new(Mutex::new(child)),
            stdin,
            stdout: BufReader::new(stdout),
        })
    }

    fn is_alive(&mut self) -> bool {
        self.child
            .lock()
            .map(|mut child| matches!(child.try_wait(), Ok(None)))
            .unwrap_or(false)
    }

    fn read_line(&mut self) -> Result<String, String> {
        let mut line = String::new();
        let count = self
            .stdout
            .read_line(&mut line)
            .map_err(|error| format!("CLAP helper read failed: {error}"))?;
        if count == 0 {
            return Err("the CLAP helper exited unexpectedly".to_string());
        }
        Ok(line.trim_end_matches(['\r', '\n']).to_string())
    }

    fn scan(&mut self) -> Result<Vec<LinuxPluginDescriptor>, String> {
        let watch = CommandWatch::start(Arc::clone(&self.child))?;
        let result = self.scan_inner();
        if watch.finish() {
            Err("CLAP library scan exceeded 10 seconds; the helper was terminated".to_string())
        } else {
            result
        }
    }

    fn scan_inner(&mut self) -> Result<Vec<LinuxPluginDescriptor>, String> {
        self.stdin
            .write_all(b"SCAN\n")
            .and_then(|_| self.stdin.flush())
            .map_err(|error| format!("CLAP helper write failed: {error}"))?;
        let header = self.read_line()?;
        if let Some(message) = header.strip_prefix("ERROR ") {
            return Err(message.to_string());
        }
        let count = header
            .strip_prefix("SCAN ")
            .and_then(|value| value.parse::<usize>().ok())
            .ok_or_else(|| format!("unexpected CLAP helper response: {header}"))?;
        let mut plugins = Vec::with_capacity(count);
        for _ in 0..count {
            let line = self.read_line()?;
            if let Some(message) = line.strip_prefix("ERROR ") {
                return Err(message.to_string());
            }
            let mut fields = line.splitn(3, '\t');
            let id = fields.next().unwrap_or_default().to_string();
            let name = fields.next().unwrap_or_default().to_string();
            let vendor = fields.next().unwrap_or_default().to_string();
            if !id.is_empty() {
                plugins.push(LinuxPluginDescriptor { id, name, vendor });
            }
        }
        Ok(plugins)
    }
}

#[cfg(target_os = "linux")]
impl Drop for ClapHelper {
    fn drop(&mut self) {
        let _ = self.stdin.write_all(b"QUIT\n");
        let _ = self.stdin.flush();
        for _ in 0..20 {
            if self
                .child
                .lock()
                .map(|mut child| matches!(child.try_wait(), Ok(Some(_))))
                .unwrap_or(true)
            {
                return;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[cfg(target_os = "linux")]
fn staged_name() -> String {
    format!(
        "binaries/openbeats-clap-helper-{}-unknown-linux-gnu",
        std::env::consts::ARCH
    )
}

#[cfg(target_os = "linux")]
pub fn clap_helper_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let names = [
        format!(
            "openbeats-clap-helper-{}-unknown-linux-gnu",
            std::env::consts::ARCH
        ),
        "openbeats-clap-helper".to_string(),
    ];
    let mut roots = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        roots.push(resource_dir);
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            roots.push(parent.to_path_buf());
        }
    }
    roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries"));

    for root in roots {
        for name in &names {
            let candidate = root.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(target_os = "linux")]
fn with_helper<T>(
    app: &tauri::AppHandle,
    helper_state: &Mutex<Option<ClapHelper>>,
    action: impl FnOnce(&mut ClapHelper) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = helper_state
        .lock()
        .map_err(|_| "the Linux CLAP host is unavailable".to_string())?;
    let dead = guard.as_mut().is_some_and(|helper| !helper.is_alive());
    if dead {
        *guard = None;
    }
    if guard.is_none() {
        *guard = Some(ClapHelper::spawn(app)?);
    }
    action(guard.as_mut().expect("helper was just created"))
}

/// Scans Linux CLAP paths in the sidecar and returns typed descriptors.
#[tauri::command]
pub async fn scan_plugins_linux(
    app: tauri::AppHandle,
    state: State<'_, ClapState>,
) -> Result<Vec<LinuxPluginDescriptor>, String> {
    #[cfg(target_os = "linux")]
    {
        let helper_state = Arc::clone(&state.helper);
        tauri::async_runtime::spawn_blocking(move || {
            with_helper(&app, &helper_state, |helper| helper.scan())
        })
        .await
        .map_err(|error| format!("plugin scan task failed: {error}"))?
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, state);
        Err("Linux CLAP hosting is only available on Linux".to_string())
    }
}

/// Probes one plugin in a disposable helper by loading, activating and
/// processing silence, then returns its host-visible parameter metadata.
#[tauri::command]
pub async fn load_plugin_linux(
    app: tauri::AppHandle,
    id: String,
) -> Result<Vec<openbeats_audio::plugin::ClapParameter>, String> {
    #[cfg(target_os = "linux")]
    {
        let helper = clap_helper_path(&app).ok_or_else(|| {
            format!(
                "openbeats-clap-helper was not found; build a Linux helper and stage it at {}",
                staged_name()
            )
        })?;
        tauri::async_runtime::spawn_blocking(move || {
            openbeats_audio::plugin::PluginProcessor::probe(&helper, &id)
        })
        .await
        .map_err(|error| format!("plugin load probe task failed: {error}"))?
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, id);
        Err("Linux CLAP hosting is only available on Linux".to_string())
    }
}
