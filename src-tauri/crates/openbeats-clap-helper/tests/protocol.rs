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
    fs::copy(fixture, dir.path().join("OpenBeatsGain.clap")).expect("copy proof plugin");
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
