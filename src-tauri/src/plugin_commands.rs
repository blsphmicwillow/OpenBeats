//! Tauri commands for VST3/CLAP hosting.
//!
//! Every call goes through a helper process, so plugin crashes are contained
//! and reported instead of taking the studio down. Windows/macOS keep the
//! existing `plughost` helper; Linux uses the CLAP-only sidecar.

use std::path::PathBuf;
use std::sync::Mutex;

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
    helper: Mutex<Option<ClapHelper>>,
}

impl ClapState {
    pub fn new() -> Self {
        Self {
            #[cfg(target_os = "linux")]
            helper: Mutex::new(None),
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

#[cfg(target_os = "linux")]
struct ClapHelper {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

#[cfg(target_os = "linux")]
impl ClapHelper {
    fn spawn(app: &tauri::AppHandle) -> Result<Self, String> {
        let path = helper_path(app).ok_or_else(|| {
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
            child,
            stdin,
            stdout: BufReader::new(stdout),
        })
    }

    fn is_alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
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

    fn load(&mut self, id: &str) -> Result<(), String> {
        if id.is_empty() || id.contains(['\r', '\n']) {
            return Err("invalid plugin id".to_string());
        }
        self.stdin
            .write_all(format!("LOAD {id}\n").as_bytes())
            .and_then(|_| self.stdin.flush())
            .map_err(|error| format!("CLAP helper write failed: {error}"))?;
        let response = self.read_line()?;
        if response == "READY" {
            Ok(())
        } else if let Some(message) = response.strip_prefix("ERROR ") {
            Err(message.to_string())
        } else {
            Err(format!("unexpected CLAP helper response: {response}"))
        }
    }
}

#[cfg(target_os = "linux")]
impl Drop for ClapHelper {
    fn drop(&mut self) {
        let _ = self.stdin.write_all(b"QUIT\n");
        let _ = self.stdin.flush();
        for _ in 0..20 {
            if matches!(self.child.try_wait(), Ok(Some(_))) {
                return;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
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
fn helper_path(app: &tauri::AppHandle) -> Option<PathBuf> {
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
    state: &State<'_, ClapState>,
    action: impl FnOnce(&mut ClapHelper) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = state
        .helper
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
        with_helper(&app, &state, |helper| helper.scan())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, state);
        Err("Linux CLAP hosting is only available on Linux".to_string())
    }
}

/// Loads one scanned plugin into the sidecar. READY means the plugin instance
/// was created and activated; it does not yet mean the plugin is in the mixer.
#[tauri::command]
pub async fn load_plugin_linux(
    app: tauri::AppHandle,
    state: State<'_, ClapState>,
    id: String,
) -> Result<String, String> {
    #[cfg(target_os = "linux")]
    {
        with_helper(&app, &state, |helper| helper.load(&id))?;
        Ok("READY".to_string())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, state, id);
        Err("Linux CLAP hosting is only available on Linux".to_string())
    }
}
