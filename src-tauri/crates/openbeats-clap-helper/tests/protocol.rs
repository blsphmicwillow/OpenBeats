#![cfg(target_os = "linux")]

use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

struct TempDir(PathBuf);

impl TempDir {
    fn new(label: &str) -> Self {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_nanos())
            .unwrap_or_default();
        let id = NEXT_TEMP.fetch_add(1, Ordering::Relaxed);
        let path = env::temp_dir().join(format!(
            "openbeats-clap-{label}-{}-{stamp}-{id}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("create temp directory");
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

struct Helper {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    _home: TempDir,
}

impl Helper {
    fn spawn(clap_path: &Path) -> Self {
        let home = TempDir::new("home");
        let mut child = Command::new(env!("CARGO_BIN_EXE_openbeats-clap-helper"))
            .env("HOME", home.path())
            .env("CLAP_PATH", clap_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn openbeats-clap-helper");
        let stdin = child.stdin.take().expect("helper stdin");
        let stdout = child.stdout.take().expect("helper stdout");
        Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
            _home: home,
        }
    }

    fn line(&mut self) -> Result<String, String> {
        let mut line = String::new();
        let count = self
            .stdout
            .read_line(&mut line)
            .map_err(|error| format!("read failed: {error}"))?;
        if count == 0 {
            return Err("helper exited unexpectedly".to_string());
        }
        Ok(line.trim_end_matches(['\r', '\n']).to_string())
    }

    fn send(&mut self, command: &str) -> Result<(), String> {
        self.stdin
            .write_all(command.as_bytes())
            .and_then(|_| self.stdin.flush())
            .map_err(|error| format!("write failed: {error}"))
    }

    fn scan(&mut self) -> Result<Vec<(String, String, String)>, String> {
        self.send("SCAN\n")?;
        let header = self.line()?;
        if let Some(message) = header.strip_prefix("ERROR ") {
            return Err(message.to_string());
        }
        let count = header
            .strip_prefix("SCAN ")
            .and_then(|value| value.parse::<usize>().ok())
            .ok_or_else(|| format!("unexpected scan header: {header}"))?;
        let mut entries = Vec::with_capacity(count);
        for _ in 0..count {
            let line = self.line()?;
            if let Some(message) = line.strip_prefix("ERROR ") {
                return Err(message.to_string());
            }
            let mut fields = line.splitn(3, '\t');
            entries.push((
                fields.next().unwrap_or_default().to_string(),
                fields.next().unwrap_or_default().to_string(),
                fields.next().unwrap_or_default().to_string(),
            ));
        }
        Ok(entries)
    }

    fn load(&mut self, id: &str) -> Result<(), String> {
        self.send(&format!("LOAD {id}\n"))?;
        match self.line()?.as_str() {
            "READY" => Ok(()),
            response => response
                .strip_prefix("ERROR ")
                .map(|message| Err(message.to_string()))
                .unwrap_or_else(|| Err(format!("unexpected load response: {response}"))),
        }
    }

    fn load_config(
        &mut self,
        id: &str,
        sample_rate: f64,
        block_size: usize,
    ) -> Result<u32, String> {
        self.send(&format!("LOAD_CONFIG {id}\t{sample_rate}\t{block_size}\n"))?;
        let response = self.line()?;
        if let Some(message) = response.strip_prefix("ERROR ") {
            return Err(message.to_string());
        }
        response
            .strip_prefix("READY ")
            .and_then(|latency| latency.parse::<u32>().ok())
            .ok_or_else(|| format!("unexpected configured load response: {response}"))
    }

    fn load_config_state(
        &mut self,
        id: &str,
        sample_rate: f64,
        block_size: usize,
        state: &[u8],
    ) -> Result<u32, String> {
        let command = format!(
            "LOAD_CONFIG_STATE {id}\t{sample_rate}\t{block_size}\t{}\n",
            state.len()
        );
        self.stdin
            .write_all(command.as_bytes())
            .and_then(|_| self.stdin.write_all(state))
            .and_then(|_| self.stdin.flush())
            .map_err(|error| format!("write failed: {error}"))?;
        let response = self.line()?;
        if let Some(message) = response.strip_prefix("ERROR ") {
            return Err(message.to_string());
        }
        response
            .strip_prefix("READY ")
            .and_then(|latency| latency.parse::<u32>().ok())
            .ok_or_else(|| format!("unexpected state load response: {response}"))
    }

    fn save_state(&mut self) -> Result<Option<Vec<u8>>, String> {
        self.send("SAVE_STATE\n")?;
        let response = self.line()?;
        if let Some(message) = response.strip_prefix("ERROR ") {
            return Err(message.to_string());
        }
        if response == "UNSUPPORTED" {
            return Ok(None);
        }
        let length = response
            .strip_prefix("STATE ")
            .and_then(|value| value.parse::<usize>().ok())
            .ok_or_else(|| format!("unexpected state save response: {response}"))?;
        if length > 64 * 1024 * 1024 {
            return Err("helper returned oversized plugin state".to_string());
        }
        let mut state = vec![0; length];
        self.stdout
            .read_exact(&mut state)
            .map_err(|error| format!("read state failed: {error}"))?;
        Ok(Some(state))
    }

    fn parameters(&mut self) -> Result<Vec<serde_json::Value>, String> {
        self.send("PARAMS\n")?;
        let response = self.line()?;
        if let Some(message) = response.strip_prefix("ERROR ") {
            return Err(message.to_string());
        }
        let json = response
            .strip_prefix("PARAMS ")
            .ok_or_else(|| format!("unexpected parameter response: {response}"))?;
        serde_json::from_str(json).map_err(|error| format!("invalid parameter JSON: {error}"))
    }

    fn set_parameter(&mut self, id: u32, value: f64) -> Result<(), String> {
        self.send(&format!("PARAM {id}\t{value}\n"))?;
        match self.line()?.as_str() {
            "PARAM_SET" => Ok(()),
            response => response
                .strip_prefix("ERROR ")
                .map(|message| Err(message.to_string()))
                .unwrap_or_else(|| Err(format!("unexpected parameter response: {response}"))),
        }
    }

    fn open_gui(&mut self) -> Result<(), String> {
        self.send("GUI_OPEN\n")?;
        let response = self.line()?;
        if response == "GUI_OPEN" {
            Ok(())
        } else if let Some(message) = response.strip_prefix("ERROR ") {
            Err(message.to_string())
        } else {
            Err(format!("unexpected GUI response: {response}"))
        }
    }

    fn close_gui(&mut self) -> Result<(), String> {
        self.send("GUI_CLOSE\n")?;
        let response = self.line()?;
        if response == "GUI_CLOSED" {
            Ok(())
        } else if let Some(message) = response.strip_prefix("ERROR ") {
            Err(message.to_string())
        } else {
            Err(format!("unexpected GUI close response: {response}"))
        }
    }

    fn process(&mut self, frames: usize, samples: &[f32]) -> Result<Vec<f32>, String> {
        if samples.len() != frames * 2 {
            return Err("test supplied the wrong sample count".to_string());
        }
        self.send(&format!("PROCESS {frames}\n"))?;
        let mut bytes = Vec::with_capacity(samples.len() * 4);
        for sample in samples {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        self.stdin
            .write_all(&bytes)
            .and_then(|_| self.stdin.flush())
            .map_err(|error| format!("write failed: {error}"))?;
        let header = self.line()?;
        if let Some(message) = header.strip_prefix("ERROR ") {
            return Err(message.to_string());
        }
        if header != format!("PROCESSED {frames}") {
            return Err(format!("unexpected process response: {header}"));
        }
        let mut output = vec![0u8; samples.len() * 4];
        self.stdout
            .read_exact(&mut output)
            .map_err(|error| format!("read audio failed: {error}"))?;
        Ok(output
            .chunks_exact(4)
            .map(|chunk| f32::from_le_bytes(chunk.try_into().unwrap()))
            .collect())
    }

    fn kill(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for Helper {
    fn drop(&mut self) {
        let _ = self.stdin.write_all(b"QUIT\n");
        let _ = self.stdin.flush();
        for _ in 0..20 {
            if matches!(self.child.try_wait(), Ok(Some(_))) {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn proof_plugin() -> Option<PathBuf> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../plugins/openbeats-gain/dist/OpenBeatsGain.clap");
    path.is_file().then_some(path)
}

fn plugin_dir(fixture: &Path) -> TempDir {
    let dir = TempDir::new("plugins");
    let filename = fixture.file_name().expect("fixture filename");
    fs::copy(fixture, dir.path().join(filename)).expect("copy proof plugin");
    dir
}

fn sine(frames: usize) -> Vec<f32> {
    let mut samples = Vec::with_capacity(frames * 2);
    for frame in 0..frames {
        let sample = 0.1 * (2.0 * std::f32::consts::PI * 440.0 * frame as f32 / 48_000.0).sin();
        samples.push(sample);
        samples.push(sample);
    }
    samples
}

fn rms(samples: &[f32]) -> f32 {
    (samples.iter().map(|sample| sample * sample).sum::<f32>() / samples.len() as f32).sqrt()
}

fn settle_gain(helper: &mut Helper) -> Vec<f32> {
    let mut output = Vec::new();
    for _ in 0..50 {
        output = helper
            .process(64, &sine(64))
            .expect("process parameter update");
    }
    output
}

#[test]
fn scans_clap_path_then_loads_and_processes_gain() {
    let Some(fixture) = proof_plugin() else {
        eprintln!("SKIP: plugins/openbeats-gain/dist/OpenBeatsGain.clap is not built");
        return;
    };
    let plugins = plugin_dir(&fixture);
    let mut helper = Helper::spawn(plugins.path());

    let entries = helper.scan().expect("SCAN");
    assert!(
        entries
            .iter()
            .any(|(id, name, _)| id == "studio.openbeats.gain" && name == "OpenBeats Gain"),
        "scan did not find the proof plugin: {entries:?}"
    );

    helper.load("studio.openbeats.gain").expect("LOAD");
    let input = sine(64);
    let output = helper.process(64, &input).expect("PROCESS");
    assert_eq!(output.len(), input.len());
    assert!(output.iter().all(|sample| sample.is_finite()));
    assert!((rms(&input) - rms(&output)).abs() < 1e-4);
}

#[test]
fn configured_load_uses_the_requested_rate_and_maximum_block() {
    let Some(fixture) = proof_plugin() else {
        eprintln!("SKIP: plugins/openbeats-gain/dist/OpenBeatsGain.clap is not built");
        return;
    };
    let plugins = plugin_dir(&fixture);
    let mut helper = Helper::spawn(plugins.path());
    let latency = helper
        .load_config("studio.openbeats.gain", 44_100.0, 64)
        .expect("LOAD_CONFIG scans, loads and activates without a prior SCAN");
    assert_eq!(latency, 0);

    let input = sine(64);
    let output = helper
        .process(64, &input)
        .expect("PROCESS at configured block size");
    assert_eq!(output.len(), input.len());
    assert!((rms(&input) - rms(&output)).abs() < 1e-4);

    let error = helper
        .process(65, &vec![0.0; 130])
        .expect_err("blocks larger than the activation maximum must fail");
    assert!(error.contains("frame count must be 1..=64"), "{error}");
}

#[test]
fn parameter_metadata_and_changes_reach_the_plugin_processor() {
    let Some(fixture) = proof_plugin() else {
        eprintln!("SKIP: plugins/openbeats-gain/dist/OpenBeatsGain.clap is not built");
        return;
    };
    let plugins = plugin_dir(&fixture);
    let mut helper = Helper::spawn(plugins.path());
    helper
        .load_config("studio.openbeats.gain", 48_000.0, 64)
        .expect("configured load");

    let parameters = helper.parameters().expect("PARAMS");
    let gain = parameters
        .iter()
        .find(|parameter| parameter["name"] == "Gain")
        .expect("OpenBeats Gain parameter");
    let id = gain["id"].as_u64().unwrap() as u32;
    assert!(gain["min_value"].as_f64().unwrap() < 0.5);
    assert!(gain["max_value"].as_f64().unwrap() > 0.5);

    helper.set_parameter(id, 0.25).expect("PARAM");
    let output = settle_gain(&mut helper);
    let updated_gain = helper
        .parameters()
        .expect("updated PARAMS")
        .into_iter()
        .find(|parameter| parameter["id"] == id)
        .expect("updated gain parameter");
    assert_eq!(updated_gain["value"].as_f64(), Some(0.25));
    let ratio = rms(&output) / rms(&sine(64));
    assert!(
        (0.03..0.1).contains(&ratio),
        "setting the normalized parameter should reduce gain, got {ratio}"
    );

    let error = helper
        .set_parameter(id, f64::NAN)
        .expect_err("non-finite values must be rejected");
    assert!(error.contains("finite"), "{error}");
}

#[test]
fn plugin_without_gui_reports_native_editor_unavailable_without_stopping_processing() {
    let Some(fixture) = proof_plugin() else {
        eprintln!("SKIP: plugins/openbeats-gain/dist/OpenBeatsGain.clap is not built");
        return;
    };
    let plugins = plugin_dir(&fixture);
    let mut helper = Helper::spawn(plugins.path());
    helper
        .load_config("studio.openbeats.gain", 48_000.0, 64)
        .expect("configured load");

    let error = helper
        .open_gui()
        .expect_err("the proof plugin has no native GUI extension");
    assert!(
        error.contains("does not provide the CLAP GUI extension"),
        "{error}"
    );

    let input = sine(64);
    let output = helper
        .process(64, &input)
        .expect("processing remains available after the GUI probe");
    assert_eq!(output.len(), input.len());
    assert!((rms(&input) - rms(&output)).abs() < 1e-4);
}

#[test]
fn x11_plugin_gui_can_be_opened_and_closed() {
    let Some(fixture) = env::var_os("OPENBEATS_GUI_CLAP_FIXTURE").map(PathBuf::from) else {
        eprintln!("SKIP: OPENBEATS_GUI_CLAP_FIXTURE is not set");
        return;
    };
    assert!(fixture.is_file(), "GUI fixture does not exist: {}", fixture.display());

    let plugins = plugin_dir(&fixture);
    let mut helper = Helper::spawn(plugins.path());
    helper
        .load_config("studio.openbeats.gui-fixture", 48_000.0, 64)
        .expect("configured GUI fixture load");

    helper.open_gui().expect("create and show native X11 GUI");
    helper.close_gui().expect("hide native X11 GUI");
    helper.open_gui().expect("reopen native X11 GUI");
    helper.close_gui().expect("close reopened native X11 GUI");
}

#[test]
fn third_party_x11_plugin_gui_can_be_opened_and_closed() {
    let Some(fixture) = env::var_os("OPENBEATS_THIRD_PARTY_GUI_CLAP").map(PathBuf::from) else {
        eprintln!("SKIP: OPENBEATS_THIRD_PARTY_GUI_CLAP is not set");
        return;
    };
    assert!(fixture.is_file(), "third-party GUI plugin does not exist: {}", fixture.display());
    let plugin_id = env::var("OPENBEATS_THIRD_PARTY_GUI_CLAP_ID")
        .expect("OPENBEATS_THIRD_PARTY_GUI_CLAP_ID must identify the third-party plugin");

    let plugins = plugin_dir(&fixture);
    let mut helper = Helper::spawn(plugins.path());
    helper
        .load_config(&plugin_id, 48_000.0, 64)
        .expect("configured third-party plugin load");

    helper
        .open_gui()
        .expect("create and show third-party native X11 GUI");
    std::thread::sleep(std::time::Duration::from_millis(100));
    helper
        .close_gui()
        .expect("hide third-party native X11 GUI");
}

#[test]
fn plugin_state_can_be_saved_and_restored_before_activation() {
    let Some(fixture) = proof_plugin() else {
        eprintln!("SKIP: plugins/openbeats-gain/dist/OpenBeatsGain.clap is not built");
        return;
    };
    let plugins = plugin_dir(&fixture);
    let mut helper = Helper::spawn(plugins.path());
    helper
        .load_config("studio.openbeats.gain", 48_000.0, 64)
        .expect("initial configured load");
    let gain_id = helper
        .parameters()
        .expect("PARAMS")
        .iter()
        .find(|parameter| parameter["name"] == "Gain")
        .expect("OpenBeats Gain parameter")["id"]
        .as_u64()
        .unwrap() as u32;
    helper
        .set_parameter(gain_id, 0.25)
        .expect("set gain before state save");
    settle_gain(&mut helper);
    let state = helper
        .save_state()
        .expect("SAVE_STATE")
        .expect("proof plugin supports state");
    assert!(
        !state.is_empty(),
        "the proof plugin should emit saved state"
    );

    assert_eq!(
        helper
            .load_config_state("studio.openbeats.gain", 48_000.0, 64, &state)
            .expect("restore state before activation"),
        0
    );
    let restored_gain = helper
        .parameters()
        .expect("restored PARAMS")
        .into_iter()
        .find(|parameter| parameter["id"] == gain_id)
        .expect("restored gain parameter");
    assert_eq!(restored_gain["value"].as_f64(), Some(0.25));
    let input = sine(64);
    let output = helper.process(64, &input).expect("PROCESS after restore");
    assert_eq!(output.len(), input.len());
    let ratio = rms(&output) / rms(&input);
    assert!(
        (0.03..0.1).contains(&ratio),
        "restored plugin state should reduce gain, got {ratio}"
    );
}

#[test]
fn reports_unknown_load_and_process_before_load() {
    let plugins = TempDir::new("empty-plugins");
    let mut helper = Helper::spawn(plugins.path());

    let load_error = helper
        .load("does.not.exist")
        .expect_err("unknown id must fail");
    assert!(load_error.contains("was not found"), "{load_error}");

    let process_error = helper
        .process(64, &vec![0.0; 128])
        .expect_err("no plugin must fail");
    assert!(
        process_error.contains("no plugin loaded"),
        "{process_error}"
    );
}

#[test]
fn detects_a_killed_helper() {
    let Some(fixture) = proof_plugin() else {
        eprintln!("SKIP: plugins/openbeats-gain/dist/OpenBeatsGain.clap is not built");
        return;
    };
    let plugins = plugin_dir(&fixture);
    let mut helper = Helper::spawn(plugins.path());
    helper.scan().expect("SCAN");
    helper.load("studio.openbeats.gain").expect("LOAD");
    helper.kill();

    let error = helper
        .process(64, &vec![0.0; 128])
        .expect_err("a killed helper must be reported");
    assert!(
        error.contains("exited") || error.contains("write failed") || error.contains("read failed"),
        "unexpected kill error: {error}"
    );
}
