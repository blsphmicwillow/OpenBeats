//! Session recovery.
//!
//! A background thread keeps the newest project snapshot and writes it to a
//! hidden `.recovery` file at most once every 30 seconds, so a crash costs at
//! most half a minute of work. Writes go to a temporary file and are renamed into
//! place, so a crash mid-write never leaves a half-written project behind.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

/// How often a pending snapshot is flushed to disk.
const INTERVAL: Duration = Duration::from_secs(30);

enum Message {
    Save(String),
    Flush,
    Stop,
}

/// Handle to the recovery thread. Dropping it flushes and stops the thread.
pub struct Recovery {
    sender: Option<Sender<Message>>,
    thread: Option<JoinHandle<()>>,
    path: PathBuf,
}

impl Recovery {
    pub fn start(path: PathBuf) -> Self {
        let (sender, receiver) = mpsc::channel::<Message>();
        let worker_path = path.clone();
        let thread = std::thread::Builder::new()
            .name("openbeats-recovery".into())
            .spawn(move || {
                let mut pending: Option<String> = None;
                let mut last_write = Instant::now();
                loop {
                    match receiver.recv_timeout(Duration::from_millis(500)) {
                        Ok(Message::Save(contents)) => {
                            pending = Some(contents);
                            if last_write.elapsed() >= INTERVAL {
                                if let Some(contents) = pending.take() {
                                    write_snapshot(&worker_path, &contents);
                                }
                                last_write = Instant::now();
                            }
                        }
                        Ok(Message::Flush) => {
                            if let Some(contents) = pending.take() {
                                write_snapshot(&worker_path, &contents);
                            }
                            last_write = Instant::now();
                        }
                        Ok(Message::Stop) => {
                            if let Some(contents) = pending.take() {
                                write_snapshot(&worker_path, &contents);
                            }
                            break;
                        }
                        Err(RecvTimeoutError::Timeout) => {
                            // Persist an idle snapshot once the interval has passed.
                            if last_write.elapsed() >= INTERVAL {
                                if let Some(contents) = pending.take() {
                                    write_snapshot(&worker_path, &contents);
                                }
                                last_write = Instant::now();
                            }
                        }
                        Err(RecvTimeoutError::Disconnected) => {
                            if let Some(contents) = pending.take() {
                                write_snapshot(&worker_path, &contents);
                            }
                            break;
                        }
                    }
                }
            })
            .ok();
        Self {
            sender: Some(sender),
            thread,
            path,
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn update(&self, contents: String) {
        if let Some(sender) = &self.sender {
            let _ = sender.send(Message::Save(contents));
        }
    }

    pub fn flush(&self) {
        if let Some(sender) = &self.sender {
            let _ = sender.send(Message::Flush);
        }
    }
}

impl Drop for Recovery {
    fn drop(&mut self) {
        if let Some(sender) = self.sender.take() {
            let _ = sender.send(Message::Stop);
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn write_snapshot(path: &Path, contents: &str) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let temporary = path.with_extension("tmp");
    let written = std::fs::File::create(&temporary).and_then(|mut file| {
        file.write_all(contents.as_bytes())?;
        file.sync_all()
    });
    match written.and_then(|_| std::fs::rename(&temporary, path)) {
        Ok(()) => println!(
            "openbeats: recovery snapshot written ({} bytes)",
            contents.len()
        ),
        Err(err) => eprintln!("openbeats: could not write the recovery snapshot: {err}"),
    }
}

/// Where the snapshot lives for this install.
pub fn snapshot_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("no app data directory: {err}"))?;
    Ok(dir.join(".recovery").join("session.obeats"))
}

#[derive(Default)]
pub struct RecoveryState {
    inner: Mutex<Option<Recovery>>,
}

/// Starts the 30-second recovery thread (idempotent) and returns the file path.
#[tauri::command]
pub fn start_session_recovery(
    app: tauri::AppHandle,
    state: tauri::State<'_, RecoveryState>,
) -> Result<String, String> {
    let path = snapshot_path(&app)?;
    let mut guard = state
        .inner
        .lock()
        .map_err(|_| "the recovery state is unavailable".to_string())?;
    if guard.is_none() {
        *guard = Some(Recovery::start(path.clone()));
    }
    Ok(path.display().to_string())
}

/// Queues a snapshot; the thread writes it within 30 seconds.
#[tauri::command]
pub fn recovery_update(
    state: tauri::State<'_, RecoveryState>,
    contents: String,
) -> Result<(), String> {
    if let Ok(guard) = state.inner.lock() {
        if let Some(recovery) = guard.as_ref() {
            recovery.update(contents);
        }
    }
    Ok(())
}

/// Writes the pending snapshot immediately (on save, or before closing).
#[tauri::command]
pub fn recovery_flush(state: tauri::State<'_, RecoveryState>) -> Result<(), String> {
    if let Ok(guard) = state.inner.lock() {
        if let Some(recovery) = guard.as_ref() {
            recovery.flush();
        }
    }
    Ok(())
}

/// The last snapshot, for the "recover session" prompt on startup.
#[tauri::command]
pub fn read_recovery(app: tauri::AppHandle) -> Option<String> {
    std::fs::read_to_string(snapshot_path(&app).ok()?).ok()
}

/// Removes the snapshot after a successful save or restore.
#[tauri::command]
pub fn clear_recovery(app: tauri::AppHandle) -> Result<(), String> {
    let path = snapshot_path(&app)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!("could not remove {path:?}: {err}")),
    }
}
