use crossbeam_queue::ArrayQueue;
use std::cell::UnsafeCell;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const QUEUE_CAPACITY: usize = 8192;
const STATUS_STARTING: u8 = 0;
const STATUS_READY: u8 = 1;
pub(crate) const STATUS_FAILED: u8 = 2;
pub const DEFAULT_PLUGIN_QUANTUM: usize = 256;
const LOAD_TIMEOUT: Duration = Duration::from_secs(10);
const HANG_TIMEOUT: Duration = Duration::from_secs(1);
const CONTROL_TIMEOUT: Duration = Duration::from_secs(10);
const STATE_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_PLUGIN_STATE_BYTES: usize = 64 * 1024 * 1024;
const MAX_PLUGIN_LATENCY_SECONDS: f64 = 10.0;
const PARAMETER_QUEUE_CAPACITY: usize = 128;

#[derive(Clone, Debug)]
pub(crate) struct PluginControl {
    sender: mpsc::SyncSender<PluginWorkerCommand>,
    parameter_queue: Arc<ArrayQueue<ParameterChange>>,
    parameters: Arc<[ClapParameter]>,
}

#[derive(Clone, Copy, Debug)]
struct ParameterChange {
    id: u32,
    value: f64,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize, PartialEq)]
pub struct ClapParameter {
    pub id: u32,
    pub name: String,
    pub module: String,
    pub min_value: f64,
    pub max_value: f64,
    pub default_value: f64,
    pub value: f64,
    pub readonly: bool,
    pub hidden: bool,
    pub stepped: bool,
}

#[derive(Debug)]
enum PluginWorkerCommand {
    SaveState(mpsc::SyncSender<Result<Option<Vec<u8>>, String>>),
    GetParameters(mpsc::SyncSender<Result<Vec<ClapParameter>, String>>),
    FlushParameters(mpsc::SyncSender<Result<(), String>>),
    SetGuiOpen(bool, Option<u64>, mpsc::SyncSender<Result<(), String>>),
}

impl PluginControl {
    pub(crate) fn save_state(&self) -> Result<Option<Vec<u8>>, String> {
        let (reply, response) = mpsc::sync_channel(1);
        match self.sender.try_send(PluginWorkerCommand::SaveState(reply)) {
            Ok(()) => {}
            Err(mpsc::TrySendError::Full(_)) => {
                return Err("the plugin control queue is busy".to_string())
            }
            Err(mpsc::TrySendError::Disconnected(_)) => {
                return Err("the plugin worker has stopped".to_string())
            }
        }
        response
            .recv_timeout(STATE_TIMEOUT)
            .map_err(|_| "the plugin did not save its state within 10 seconds".to_string())?
    }

    pub(crate) fn parameters(&self) -> Result<Vec<ClapParameter>, String> {
        let (reply, response) = mpsc::sync_channel(1);
        match self
            .sender
            .try_send(PluginWorkerCommand::GetParameters(reply))
        {
            Ok(()) => {}
            Err(mpsc::TrySendError::Full(_)) => {
                return Err("the plugin control queue is busy".to_string())
            }
            Err(mpsc::TrySendError::Disconnected(_)) => {
                return Err("the plugin worker has stopped".to_string())
            }
        }
        response
            .recv_timeout(STATE_TIMEOUT)
            .map_err(|_| "the plugin did not return parameters within 10 seconds".to_string())?
    }

    pub(crate) fn set_parameter(&self, id: u32, value: f64) -> Result<(), String> {
        if !value.is_finite() {
            return Err("parameter value must be finite".to_string());
        }
        let parameter = self
            .parameters
            .iter()
            .find(|parameter| parameter.id == id)
            .ok_or_else(|| format!("plugin does not expose parameter {id}"))?;
        if parameter.readonly {
            return Err(format!("plugin parameter {id} is read-only"));
        }
        if value < parameter.min_value || value > parameter.max_value {
            return Err(format!(
                "plugin parameter {id} must be between {} and {}",
                parameter.min_value, parameter.max_value
            ));
        }
        self.parameter_queue
            .push(ParameterChange { id, value })
            .map_err(|_| "the plugin parameter queue is full".to_string())
    }

    pub(crate) fn flush_parameters(&self) -> Result<(), String> {
        let (reply, response) = mpsc::sync_channel(1);
        match self
            .sender
            .try_send(PluginWorkerCommand::FlushParameters(reply))
        {
            Ok(()) => {}
            Err(mpsc::TrySendError::Full(_)) => {
                return Err("the plugin control queue is busy".to_string())
            }
            Err(mpsc::TrySendError::Disconnected(_)) => {
                return Err("the plugin worker has stopped".to_string())
            }
        }
        response
            .recv_timeout(STATE_TIMEOUT)
            .map_err(|_| "the plugin did not apply its parameters within 10 seconds".to_string())?
    }

    pub(crate) fn set_gui_open(&self, open: bool, parent_x11: Option<u64>) -> Result<(), String> {
        let (reply, response) = mpsc::sync_channel(1);
        match self
            .sender
            .try_send(PluginWorkerCommand::SetGuiOpen(open, parent_x11, reply))
        {
            Ok(()) => {}
            Err(mpsc::TrySendError::Full(_)) => {
                return Err("the plugin control queue is busy".to_string())
            }
            Err(mpsc::TrySendError::Disconnected(_)) => {
                return Err("the plugin worker has stopped".to_string())
            }
        }
        response.recv_timeout(CONTROL_TIMEOUT).map_err(|_| {
            "the plugin did not update its editor window within 10 seconds".to_string()
        })?
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct AudioFrame {
    pub sequence: u64,
    pub left: f32,
    pub right: f32,
}

struct Queue {
    slots: Box<[UnsafeCell<AudioFrame>]>,
    capacity: usize,
    write: AtomicU64,
    read: AtomicU64,
}

unsafe impl Send for Queue {}
unsafe impl Sync for Queue {}

pub struct Producer {
    queue: Arc<Queue>,
    write: u64,
}

pub struct Consumer {
    queue: Arc<Queue>,
    read: u64,
}

impl Producer {
    fn push(&mut self, frame: AudioFrame) -> Result<(), AudioFrame> {
        let read = self.queue.read.load(Ordering::Acquire);
        if self.write.wrapping_sub(read) >= self.queue.capacity as u64 {
            return Err(frame);
        }
        let index = self.write as usize % self.queue.capacity;
        unsafe {
            *self.queue.slots[index].get() = frame;
        }
        self.write = self.write.wrapping_add(1);
        self.queue.write.store(self.write, Ordering::Release);
        Ok(())
    }
}

impl Consumer {
    fn pop(&mut self) -> Option<AudioFrame> {
        let write = self.queue.write.load(Ordering::Acquire);
        if self.read == write {
            return None;
        }
        let index = self.read as usize % self.queue.capacity;
        let frame = unsafe { *self.queue.slots[index].get() };
        self.read = self.read.wrapping_add(1);
        self.queue.read.store(self.read, Ordering::Release);
        Some(frame)
    }
}

fn queue() -> (Producer, Consumer) {
    let slots = (0..QUEUE_CAPACITY)
        .map(|_| UnsafeCell::new(AudioFrame::default()))
        .collect::<Vec<_>>()
        .into_boxed_slice();
    let queue = Arc::new(Queue {
        slots,
        capacity: QUEUE_CAPACITY,
        write: AtomicU64::new(0),
        read: AtomicU64::new(0),
    });
    (
        Producer {
            queue: Arc::clone(&queue),
            write: 0,
        },
        Consumer { queue, read: 0 },
    )
}

pub struct PluginProcessor {
    input: Producer,
    output: Consumer,
    shutdown: Arc<AtomicBool>,
    status: Arc<AtomicU8>,
    control: PluginControl,
    submitted: Arc<AtomicU64>,
    sequence: u64,
    bridge_latency: u64,
    plugin_latency: u32,
    dry: Vec<(f32, f32)>,
    dry_index: usize,
    pending: Option<AudioFrame>,
}

pub struct PluginWorkerEndpoint {
    input: Consumer,
    output: Producer,
    shutdown: Arc<AtomicBool>,
    status: Arc<AtomicU8>,
    control_active: Arc<AtomicBool>,
    submitted: Arc<AtomicU64>,
    completed: Arc<AtomicU64>,
    control_receiver: mpsc::Receiver<PluginWorkerCommand>,
    parameter_queue: Arc<ArrayQueue<ParameterChange>>,
}

impl PluginProcessor {
    /// Creates the callback and worker halves. The callback half uses only
    /// bounded SPSC operations and preallocated delay storage in `process`.
    pub fn pair(quantum: usize, plugin_latency: u32) -> (Self, PluginWorkerEndpoint) {
        let (input, worker_input) = queue();
        let (worker_output, output) = queue();
        let parameter_queue = Arc::new(ArrayQueue::new(PARAMETER_QUEUE_CAPACITY));
        let shutdown = Arc::new(AtomicBool::new(false));
        let status = Arc::new(AtomicU8::new(STATUS_STARTING));
        let control_active = Arc::new(AtomicBool::new(false));
        let (control_sender, control_receiver) = mpsc::sync_channel(32);
        let submitted = Arc::new(AtomicU64::new(0));
        let completed = Arc::new(AtomicU64::new(0));
        let bridge_latency = (quantum.max(1) * 2) as u64;
        let dry_delay = bridge_latency + u64::from(plugin_latency);
        let dry = vec![(0.0, 0.0); dry_delay as usize + 1];

        (
            Self {
                input,
                output,
                shutdown: Arc::clone(&shutdown),
                status: Arc::clone(&status),
                control: PluginControl {
                    sender: control_sender,
                    parameter_queue: Arc::clone(&parameter_queue),
                    parameters: Arc::from(Vec::<ClapParameter>::new()),
                },
                submitted: Arc::clone(&submitted),
                sequence: 0,
                bridge_latency,
                plugin_latency,
                dry,
                dry_index: 0,
                pending: None,
            },
            PluginWorkerEndpoint {
                input: worker_input,
                output: worker_output,
                shutdown,
                status,
                control_active,
                submitted,
                completed,
                control_receiver,
                parameter_queue,
            },
        )
    }

    pub fn process(&mut self, left: f32, right: f32) -> (f32, f32) {
        let sequence = self.sequence;
        let frame = AudioFrame {
            sequence,
            left,
            right,
        };
        if self.input.push(frame).is_ok() {
            self.submitted
                .store(sequence.wrapping_add(1), Ordering::Release);
        }

        let delay = self.bridge_latency as usize + self.plugin_latency as usize;
        let dry = if delay == 0 {
            (left, right)
        } else {
            self.dry[self.dry_index] = (left, right);
            let read = (self.dry_index + self.dry.len() - delay) % self.dry.len();
            let delayed = self.dry[read];
            self.dry_index = (self.dry_index + 1) % self.dry.len();
            delayed
        };

        let expected = sequence.checked_sub(self.bridge_latency);
        let mut processed = None;
        if let Some(expected) = expected {
            let mut candidate = self.pending.take();
            loop {
                let Some(frame) = candidate.take().or_else(|| self.output.pop()) else {
                    break;
                };
                if frame.sequence < expected {
                    continue;
                }
                if frame.sequence == expected {
                    processed = Some(frame);
                } else {
                    self.pending = Some(frame);
                }
                break;
            }
        }
        self.sequence = self.sequence.wrapping_add(1);

        match (self.status.load(Ordering::Acquire), expected, processed) {
            (STATUS_READY, Some(next), Some(frame)) if frame.sequence == next => {
                (frame.left, frame.right)
            }
            _ => dry,
        }
    }

    #[cfg(target_os = "linux")]
    fn process_offline_samples(
        &mut self,
        samples: &[(f32, f32)],
    ) -> Result<Vec<(f32, f32)>, String> {
        let quantum = (self.bridge_latency / 2).max(1) as usize;
        let padded_len = samples.len().div_ceil(quantum) * quantum;
        let mut rendered = Vec::with_capacity(samples.len());

        for block_start in (0..padded_len).step_by(quantum) {
            let first_sequence = self.sequence;
            for offset in 0..quantum {
                let sample_index = block_start + offset;
                let (left, right) = samples.get(sample_index).copied().unwrap_or_default();
                let frame = AudioFrame {
                    sequence: self.sequence,
                    left,
                    right,
                };
                let deadline = Instant::now() + HANG_TIMEOUT + Duration::from_secs(2);
                loop {
                    if self.input.push(frame).is_ok() {
                        self.sequence = self.sequence.wrapping_add(1);
                        self.submitted.store(self.sequence, Ordering::Release);
                        break;
                    }
                    if self.is_failed() || Instant::now() >= deadline {
                        return Err("the plugin stopped during offline rendering".to_string());
                    }
                    thread::sleep(Duration::from_micros(250));
                }
            }

            for sequence in first_sequence..self.sequence {
                let deadline = Instant::now() + HANG_TIMEOUT + Duration::from_secs(2);
                let frame = loop {
                    if let Some(frame) = self.output.pop() {
                        break frame;
                    }
                    if self.is_failed() || Instant::now() >= deadline {
                        return Err("the plugin stopped during offline rendering".to_string());
                    }
                    thread::sleep(Duration::from_micros(250));
                };
                if frame.sequence != sequence {
                    return Err("the plugin returned offline audio out of order".to_string());
                }
                if sequence < samples.len() as u64 {
                    rendered.push((frame.left, frame.right));
                }
            }
        }

        Ok(rendered)
    }

    pub fn latency_frames(&self) -> u64 {
        self.bridge_latency + u64::from(self.plugin_latency)
    }

    #[cfg(target_os = "linux")]
    pub fn process_offline(
        helper: &Path,
        plugin_id: &str,
        sample_rate: f32,
        initial_state: Option<Vec<u8>>,
        parameters: HashMap<u32, f64>,
        samples: &[(f32, f32)],
    ) -> Result<(Vec<(f32, f32)>, u32), String> {
        let mut processor = PluginProcessor::launch(
            helper,
            plugin_id,
            sample_rate,
            DEFAULT_PLUGIN_QUANTUM,
            initial_state,
        )?;
        for (id, value) in parameters {
            processor.set_parameter(id, value)?;
        }
        processor.flush_parameters()?;
        let latency = processor.plugin_latency;
        let rendered = processor.process_offline_samples(samples)?;
        Ok((rendered, latency))
    }

    #[cfg(target_os = "linux")]
    pub fn probe(helper: &Path, plugin_id: &str) -> Result<Vec<ClapParameter>, String> {
        let mut processor =
            PluginProcessor::launch(helper, plugin_id, 48_000.0, DEFAULT_PLUGIN_QUANTUM, None)?;
        processor.process_offline_samples(&vec![(0.0, 0.0); DEFAULT_PLUGIN_QUANTUM])?;
        processor.parameters()
    }

    pub fn parameters(&self) -> Result<Vec<ClapParameter>, String> {
        self.control.parameters()
    }

    pub fn set_parameter(&self, id: u32, value: f64) -> Result<(), String> {
        self.control.set_parameter(id, value)
    }

    pub fn flush_parameters(&self) -> Result<(), String> {
        self.control.flush_parameters()
    }

    pub fn set_gui_open(&self, open: bool, parent_x11: Option<u64>) -> Result<(), String> {
        self.control.set_gui_open(open, parent_x11)
    }

    pub fn is_failed(&self) -> bool {
        self.status.load(Ordering::Acquire) == STATUS_FAILED
    }

    #[cfg(feature = "device")]
    pub(crate) fn failure_status(&self) -> Arc<AtomicU8> {
        Arc::clone(&self.status)
    }

    pub(crate) fn control(&self) -> PluginControl {
        self.control.clone()
    }

    /// Starts and activates a CLAP instance in a helper process before
    /// returning the callback endpoint.
    pub fn launch(
        helper: &Path,
        plugin_id: &str,
        sample_rate: f32,
        quantum: usize,
        initial_state: Option<Vec<u8>>,
    ) -> Result<Self, String> {
        #[cfg(target_os = "linux")]
        {
            PluginWorkerEndpoint::launch_linux(
                helper,
                plugin_id,
                sample_rate,
                quantum,
                initial_state,
            )
        }
        #[cfg(not(target_os = "linux"))]
        {
            let _ = (helper, plugin_id, sample_rate, quantum, initial_state);
            Err("Linux CLAP inserts are only supported on Linux".to_string())
        }
    }
}

impl Drop for PluginProcessor {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Release);
    }
}

impl PluginWorkerEndpoint {
    pub fn try_pop_input(&mut self) -> Option<AudioFrame> {
        self.input.pop()
    }

    pub fn try_push_output(&mut self, frame: AudioFrame) -> bool {
        if self.output.push(frame).is_ok() {
            self.completed
                .store(frame.sequence.wrapping_add(1), Ordering::Release);
            true
        } else {
            false
        }
    }

    pub fn is_shutdown(&self) -> bool {
        self.shutdown.load(Ordering::Acquire)
    }

    pub fn mark_failed(&self) {
        self.status.store(STATUS_FAILED, Ordering::Release);
    }

    pub(crate) fn mark_ready(&self) {
        self.status.store(STATUS_READY, Ordering::Release);
    }

    pub fn submitted(&self) -> u64 {
        self.submitted.load(Ordering::Acquire)
    }

    #[cfg(target_os = "linux")]
    fn launch_linux(
        helper: &Path,
        plugin_id: &str,
        sample_rate: f32,
        quantum: usize,
        initial_state: Option<Vec<u8>>,
    ) -> Result<PluginProcessor, String> {
        if !helper.is_file() {
            return Err(format!(
                "the CLAP helper is missing at {}",
                helper.display()
            ));
        }
        if plugin_id.is_empty() || plugin_id.contains(['\r', '\n', '\t']) {
            return Err("invalid CLAP plugin id".to_string());
        }
        if !sample_rate.is_finite() || sample_rate <= 0.0 {
            return Err("the audio engine reported an invalid sample rate".to_string());
        }
        if initial_state
            .as_ref()
            .is_some_and(|state| state.len() > MAX_PLUGIN_STATE_BYTES)
        {
            return Err(format!(
                "plugin state exceeds the {MAX_PLUGIN_STATE_BYTES}-byte limit"
            ));
        }
        let quantum = quantum.clamp(16, 4096);
        let (mut processor, worker) = PluginProcessor::pair(quantum, 0);
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let helper = helper.to_path_buf();
        let plugin_id = plugin_id.to_string();
        thread::Builder::new()
            .name(format!("openbeats-clap-{}", plugin_id))
            .spawn(move || {
                Self::run_plugin_worker(
                    &helper,
                    &plugin_id,
                    sample_rate,
                    quantum,
                    worker,
                    ready_tx,
                    initial_state,
                );
            })
            .map_err(|error| format!("could not start the CLAP worker: {error}"))?;

        let latency = ready_rx
            .recv_timeout(LOAD_TIMEOUT)
            .map_err(|_| "the CLAP plugin did not load within 10 seconds".to_string())??;
        if f64::from(latency) > f64::from(sample_rate) * MAX_PLUGIN_LATENCY_SECONDS {
            return Err("the CLAP plugin reported more than 10 seconds of latency".to_string());
        }
        processor.control.parameters = Arc::from(processor.control.parameters()?);
        processor.plugin_latency = latency;
        let dry_delay = processor.latency_frames() as usize;
        processor.dry = vec![(0.0, 0.0); dry_delay + 1];
        Ok(processor)
    }

    #[cfg(target_os = "linux")]
    fn run_plugin_worker(
        helper: &Path,
        plugin_id: &str,
        sample_rate: f32,
        quantum: usize,
        mut endpoint: PluginWorkerEndpoint,
        ready: mpsc::SyncSender<Result<u32, String>>,
        initial_state: Option<Vec<u8>>,
    ) {
        let child = Command::new(helper)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn();
        let mut child = match child {
            Ok(child) => child,
            Err(error) => {
                endpoint.mark_failed();
                let _ = ready.send(Err(format!("could not start the CLAP helper: {error}")));
                return;
            }
        };
        let Some(mut stdin) = child.stdin.take() else {
            endpoint.mark_failed();
            let _ = ready.send(Err("the CLAP helper has no stdin".to_string()));
            let _ = child.kill();
            return;
        };
        let Some(stdout) = child.stdout.take() else {
            endpoint.mark_failed();
            let _ = ready.send(Err("the CLAP helper has no stdout".to_string()));
            let _ = child.kill();
            return;
        };

        let child = Arc::new(Mutex::new(child));
        let watcher_child = Arc::clone(&child);
        let watcher_shutdown = Arc::clone(&endpoint.shutdown);
        let watcher_status = Arc::clone(&endpoint.status);
        let watcher_control_active = Arc::clone(&endpoint.control_active);
        let watcher_submitted = Arc::clone(&endpoint.submitted);
        let watcher_completed = Arc::clone(&endpoint.completed);
        let watcher = thread::Builder::new()
            .name(format!("openbeats-clap-watch-{}", plugin_id))
            .spawn(move || {
                Self::watch_plugin_helper(
                    watcher_child,
                    watcher_shutdown,
                    watcher_status,
                    watcher_control_active,
                    watcher_submitted,
                    watcher_completed,
                    quantum,
                );
            });
        if let Err(error) = watcher {
            endpoint.mark_failed();
            let _ = ready.send(Err(format!("could not start the plugin watchdog: {error}")));
            if let Ok(mut child) = child.lock() {
                let _ = child.kill();
            }
            return;
        }

        let mut stdout = BufReader::new(stdout);
        let load = match &initial_state {
            Some(state) => {
                format!(
                    "LOAD_CONFIG_STATE {plugin_id}\t{sample_rate}\t{quantum}\t{}\n",
                    state.len()
                )
            }
            None => format!("LOAD_CONFIG {plugin_id}\t{sample_rate}\t{quantum}\n"),
        };
        let mut result = stdin.write_all(load.as_bytes());
        if result.is_ok() {
            if let Some(state) = &initial_state {
                result = stdin.write_all(state);
            }
        }
        if result.is_ok() {
            result = stdin.flush();
        }
        let result = result
            .map_err(|error| format!("could not configure the CLAP helper: {error}"))
            .and_then(|_| Self::read_line(&mut stdout))
            .and_then(|line| Self::parse_ready(&line));
        let latency = match result {
            Ok(latency) => latency,
            Err(error) => {
                endpoint.mark_failed();
                let _ = ready.send(Err(error));
                let _ = stdin.write_all(b"QUIT\n");
                let _ = stdin.flush();
                return;
            }
        };

        endpoint.mark_ready();
        if ready.send(Ok(latency)).is_err() {
            endpoint.mark_failed();
            let _ = stdin.write_all(b"QUIT\n");
            let _ = stdin.flush();
            return;
        }

        let mut block = vec![AudioFrame::default(); quantum];
        let mut input_bytes = Vec::with_capacity(quantum * 8);
        let mut output_bytes = vec![0u8; quantum * 8];
        while !endpoint.is_shutdown() {
            let mut filled = 0;
            let mut command_failed = false;
            while filled < quantum && !endpoint.is_shutdown() {
                if filled == 0 {
                    endpoint.control_active.store(true, Ordering::Release);
                    let applied = Self::apply_parameter_queue(
                        &endpoint.parameter_queue,
                        &mut stdin,
                        &mut stdout,
                    );
                    endpoint.control_active.store(false, Ordering::Release);
                    if let Err(error) = applied {
                        eprintln!("openbeats: CLAP parameter update failed: {error}");
                        endpoint.mark_failed();
                        command_failed = true;
                        break;
                    }
                    match endpoint.control_receiver.try_recv() {
                        Ok(PluginWorkerCommand::SaveState(reply)) => {
                            endpoint.control_active.store(true, Ordering::Release);
                            let state = Self::save_state(&mut stdin, &mut stdout);
                            endpoint.control_active.store(false, Ordering::Release);
                            let _ = reply.send(state);
                        }
                        Ok(PluginWorkerCommand::GetParameters(reply)) => {
                            endpoint.control_active.store(true, Ordering::Release);
                            let parameters = Self::get_parameters(&mut stdin, &mut stdout);
                            endpoint.control_active.store(false, Ordering::Release);
                            let _ = reply.send(parameters);
                        }
                        Ok(PluginWorkerCommand::FlushParameters(reply)) => {
                            endpoint.control_active.store(true, Ordering::Release);
                            let result = Self::apply_parameter_queue(
                                &endpoint.parameter_queue,
                                &mut stdin,
                                &mut stdout,
                            );
                            endpoint.control_active.store(false, Ordering::Release);
                            let _ = reply.send(result);
                        }
                        Ok(PluginWorkerCommand::SetGuiOpen(open, parent_x11, reply)) => {
                            endpoint.control_active.store(true, Ordering::Release);
                            let result =
                                Self::set_gui_open(open, parent_x11, &mut stdin, &mut stdout);
                            endpoint.control_active.store(false, Ordering::Release);
                            let _ = reply.send(result);
                        }
                        Err(mpsc::TryRecvError::Empty) => {}
                        Err(mpsc::TryRecvError::Disconnected) => return,
                    }
                }
                if let Some(frame) = endpoint.try_pop_input() {
                    block[filled] = frame;
                    filled += 1;
                } else {
                    thread::sleep(Duration::from_micros(250));
                }
            }
            if endpoint.is_shutdown() || command_failed {
                break;
            }

            input_bytes.clear();
            for frame in &block {
                input_bytes.extend_from_slice(&frame.left.to_le_bytes());
                input_bytes.extend_from_slice(&frame.right.to_le_bytes());
            }
            let process = format!("PROCESS {quantum}\n");
            let result = stdin
                .write_all(process.as_bytes())
                .and_then(|_| stdin.write_all(&input_bytes))
                .and_then(|_| stdin.flush())
                .map_err(|error| format!("CLAP helper write failed: {error}"))
                .and_then(|_| Self::read_line(&mut stdout))
                .and_then(|line| {
                    if line == format!("PROCESSED {quantum}") {
                        Ok(())
                    } else if let Some(error) = line.strip_prefix("ERROR ") {
                        Err(error.to_string())
                    } else {
                        Err(format!("unexpected CLAP helper response: {line}"))
                    }
                })
                .and_then(|()| {
                    stdout
                        .read_exact(&mut output_bytes)
                        .map_err(|error| format!("CLAP helper audio read failed: {error}"))
                });
            if result.is_err() {
                endpoint.mark_failed();
                break;
            }
            for (frame, bytes) in block.iter().zip(output_bytes.chunks_exact(8)) {
                let output = AudioFrame {
                    sequence: frame.sequence,
                    left: f32::from_le_bytes(bytes[..4].try_into().unwrap()),
                    right: f32::from_le_bytes(bytes[4..].try_into().unwrap()),
                };
                if !endpoint.try_push_output(output) {
                    endpoint.mark_failed();
                    break;
                }
            }
        }
        let _ = stdin.write_all(b"QUIT\n");
        let _ = stdin.flush();
    }

    #[cfg(target_os = "linux")]
    fn read_line(reader: &mut impl BufRead) -> Result<String, String> {
        let mut line = String::new();
        let count = reader
            .read_line(&mut line)
            .map_err(|error| format!("CLAP helper read failed: {error}"))?;
        if count == 0 {
            return Err("the CLAP helper exited unexpectedly".to_string());
        }
        Ok(line.trim_end_matches(['\r', '\n']).to_string())
    }

    #[cfg(target_os = "linux")]
    fn save_state(
        stdin: &mut impl Write,
        stdout: &mut (impl BufRead + Read),
    ) -> Result<Option<Vec<u8>>, String> {
        stdin
            .write_all(b"SAVE_STATE\n")
            .and_then(|_| stdin.flush())
            .map_err(|error| format!("could not request CLAP state: {error}"))?;
        let response = Self::read_line(stdout)?;
        if response == "UNSUPPORTED" {
            return Ok(None);
        }
        if let Some(error) = response.strip_prefix("ERROR ") {
            return Err(error.to_string());
        }
        let length = response
            .strip_prefix("STATE ")
            .and_then(|value| value.parse::<usize>().ok())
            .ok_or_else(|| format!("unexpected CLAP state response: {response}"))?;
        if length > MAX_PLUGIN_STATE_BYTES {
            return Err(format!(
                "plugin state exceeds the {MAX_PLUGIN_STATE_BYTES}-byte limit"
            ));
        }
        let mut state = vec![0; length];
        stdout
            .read_exact(&mut state)
            .map_err(|error| format!("could not read CLAP state: {error}"))?;
        Ok(Some(state))
    }

    #[cfg(target_os = "linux")]
    fn apply_parameter_queue(
        parameter_queue: &ArrayQueue<ParameterChange>,
        stdin: &mut impl Write,
        stdout: &mut (impl BufRead + Read),
    ) -> Result<(), String> {
        while let Some(change) = parameter_queue.pop() {
            Self::set_parameter(stdin, stdout, change.id, change.value)?;
        }
        Ok(())
    }

    #[cfg(target_os = "linux")]
    fn get_parameters(
        stdin: &mut impl Write,
        stdout: &mut (impl BufRead + Read),
    ) -> Result<Vec<ClapParameter>, String> {
        stdin
            .write_all(b"PARAMS\n")
            .and_then(|_| stdin.flush())
            .map_err(|error| format!("could not request CLAP parameters: {error}"))?;
        let response = Self::read_line(stdout)?;
        if let Some(error) = response.strip_prefix("ERROR ") {
            return Err(error.to_string());
        }
        let json = response
            .strip_prefix("PARAMS ")
            .ok_or_else(|| format!("unexpected CLAP parameter response: {response}"))?;
        serde_json::from_str(json)
            .map_err(|error| format!("invalid CLAP parameter response: {error}"))
    }

    #[cfg(target_os = "linux")]
    fn set_parameter(
        stdin: &mut impl Write,
        stdout: &mut (impl BufRead + Read),
        id: u32,
        value: f64,
    ) -> Result<(), String> {
        if !value.is_finite() {
            return Err("parameter value must be finite".to_string());
        }

        stdin
            .write_all(format!("PARAM {id}\t{value}\n").as_bytes())
            .and_then(|_| stdin.flush())
            .map_err(|error| format!("could not set CLAP parameter: {error}"))?;
        let response = Self::read_line(stdout)?;
        if response == "PARAM_SET" {
            Ok(())
        } else if let Some(error) = response.strip_prefix("ERROR ") {
            Err(error.to_string())
        } else {
            Err(format!("unexpected CLAP parameter response: {response}"))
        }
    }

    #[cfg(target_os = "linux")]
    fn set_gui_open(
        open: bool,
        parent_x11: Option<u64>,
        stdin: &mut impl Write,
        stdout: &mut (impl BufRead + Read),
    ) -> Result<(), String> {
        let command = if open {
            match parent_x11 {
                Some(parent) => format!("GUI_OPEN {parent}\n"),
                None => "GUI_OPEN\n".to_string(),
            }
        } else {
            "GUI_CLOSE\n".to_string()
        };
        stdin
            .write_all(command.as_bytes())
            .and_then(|_| stdin.flush())
            .map_err(|error| format!("could not update CLAP editor: {error}"))?;
        let response = Self::read_line(stdout)?;
        if response == if open { "GUI_OPEN" } else { "GUI_CLOSED" } {
            Ok(())
        } else if let Some(error) = response.strip_prefix("ERROR ") {
            Err(error.to_string())
        } else {
            Err(format!("unexpected CLAP editor response: {response}"))
        }
    }

    #[cfg(target_os = "linux")]
    fn parse_ready(line: &str) -> Result<u32, String> {
        if let Some(message) = line.strip_prefix("ERROR ") {
            return Err(message.to_string());
        }
        line.strip_prefix("READY ")
            .and_then(|latency| latency.parse::<u32>().ok())
            .ok_or_else(|| format!("unexpected CLAP helper load response: {line}"))
    }

    #[cfg(target_os = "linux")]
    fn watch_plugin_helper(
        child: Arc<Mutex<Child>>,
        shutdown: Arc<AtomicBool>,
        status: Arc<AtomicU8>,
        control_active: Arc<AtomicBool>,
        submitted: Arc<AtomicU64>,
        completed: Arc<AtomicU64>,
        quantum: usize,
    ) {
        let started = Instant::now();
        let mut last_completed = 0;
        let mut last_progress = Instant::now();
        let mut control_started = None;
        loop {
            if shutdown.load(Ordering::Acquire) {
                if let Ok(mut child) = child.lock() {
                    if matches!(child.try_wait(), Ok(None)) {
                        let _ = child.kill();
                    }
                    let _ = child.wait();
                }
                return;
            }
            let state = status.load(Ordering::Acquire);
            let current_completed = completed.load(Ordering::Acquire);
            if current_completed > last_completed {
                last_completed = current_completed;
                last_progress = Instant::now();
            }

            let timeout = if state == STATUS_STARTING {
                started.elapsed() > LOAD_TIMEOUT
            } else {
                let outstanding = submitted
                    .load(Ordering::Acquire)
                    .saturating_sub(current_completed);
                let control_timeout = if control_active.load(Ordering::Acquire) {
                    let active_since = control_started.get_or_insert_with(Instant::now);
                    last_progress = Instant::now();
                    active_since.elapsed() > CONTROL_TIMEOUT
                } else {
                    control_started = None;
                    false
                };
                control_timeout
                    || (!control_active.load(Ordering::Acquire)
                        && outstanding >= quantum as u64
                        && last_progress.elapsed() > HANG_TIMEOUT)
            };
            let exited = child
                .lock()
                .map(|mut child| matches!(child.try_wait(), Ok(Some(_)) | Err(_)))
                .unwrap_or(true);
            if timeout || exited {
                status.store(STATUS_FAILED, Ordering::Release);
                if let Ok(mut child) = child.lock() {
                    if matches!(child.try_wait(), Ok(None)) {
                        let _ = child.kill();
                    }
                    let _ = child.wait();
                }
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }
    }

    pub fn completed(&self) -> u64 {
        self.completed.load(Ordering::Acquire)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounded_spsc_queue_preserves_frames_across_wraps() {
        let (mut producer, mut consumer) = queue();
        for sequence in 0..QUEUE_CAPACITY as u64 * 3 {
            let frame = AudioFrame {
                sequence,
                left: sequence as f32,
                right: -(sequence as f32),
            };
            producer.push(frame).expect("queue has space");
            let read = consumer.pop().expect("frame is published");
            assert_eq!(read, frame);
        }
    }

    #[test]
    fn processor_uses_worker_output_after_the_fixed_bridge_latency() {
        let quantum = 16;
        let (mut processor, mut worker) = PluginProcessor::pair(quantum, 0);
        worker.mark_ready();
        for sequence in 0..128 {
            let input = sequence as f32;
            let output = processor.process(input, -input);
            while let Some(mut frame) = worker.try_pop_input() {
                frame.left *= 0.5;
                frame.right *= 0.5;
                assert!(worker.try_push_output(frame));
            }
            if sequence >= (quantum * 2) as u64 {
                let expected = (sequence - (quantum * 2) as u64) as f32 * 0.5;
                assert_eq!(output, (expected, -expected));
            }
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn save_state_reads_a_bounded_binary_response() {
        let state = [0, 255, 7, 0];
        let mut response = format!("STATE {}\n", state.len()).into_bytes();
        response.extend_from_slice(&state);
        let mut stdout = BufReader::new(std::io::Cursor::new(response));
        let mut stdin = std::io::Cursor::new(Vec::new());

        assert_eq!(
            PluginWorkerEndpoint::save_state(&mut stdin, &mut stdout).unwrap(),
            Some(state.to_vec())
        );
        assert_eq!(stdin.into_inner(), b"SAVE_STATE\n");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn save_state_rejects_an_oversized_response_before_allocating() {
        let response = format!("STATE {}\n", MAX_PLUGIN_STATE_BYTES + 1);
        let mut stdout = BufReader::new(std::io::Cursor::new(response));
        let mut stdin = std::io::Cursor::new(Vec::new());

        assert!(PluginWorkerEndpoint::save_state(&mut stdin, &mut stdout)
            .unwrap_err()
            .contains("exceeds"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn supervised_offline_host_applies_real_clap_parameter_values() {
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
            eprintln!("SKIP: build and stage OpenBeats Gain and the CLAP helper first");
            return;
        }

        let plugin_id = "studio.openbeats.gain";
        let gain = PluginProcessor::probe(&helper, plugin_id)
            .expect("the proof CLAP plugin should load, activate and process")
            .into_iter()
            .find(|parameter| parameter.name == "Gain")
            .expect("OpenBeats Gain exposes a Gain parameter");
        let samples = vec![(0.1, 0.1); 48_000];
        let (output, latency) = PluginProcessor::process_offline(
            &helper,
            plugin_id,
            48_000.0,
            None,
            HashMap::from([(gain.id, 0.25)]),
            &samples,
        )
        .expect("supervised offline processing should succeed");

        assert_eq!(latency, 0);
        assert_eq!(output.len(), samples.len());
        let tail = &output[output.len() - 4096..];
        let rms =
            (tail.iter().map(|(left, _)| left * left).sum::<f32>() / tail.len() as f32).sqrt();
        assert!(
            (0.03..0.1).contains(&(rms / 0.1)),
            "setting the normalized parameter should reduce gain, got {}",
            rms / 0.1
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn live_supervised_host_applies_lock_free_parameter_updates() {
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
            eprintln!("SKIP: build and stage OpenBeats Gain and the CLAP helper first");
            return;
        }

        let mut processor = PluginProcessor::launch(
            &helper,
            "studio.openbeats.gain",
            48_000.0,
            DEFAULT_PLUGIN_QUANTUM,
            None,
        )
        .expect("the proof CLAP plugin should load for live processing");
        let gain = processor
            .parameters()
            .expect("the plugin should expose parameters")
            .into_iter()
            .find(|parameter| parameter.name == "Gain")
            .expect("OpenBeats Gain exposes a Gain parameter");
        processor
            .set_parameter(gain.id, 0.25)
            .expect("the lock-free parameter queue should accept the value");

        let mut output = Vec::new();
        let block_duration = Duration::from_secs_f64(DEFAULT_PLUGIN_QUANTUM as f64 / 48_000.0);
        for _ in 0..32 {
            for _ in 0..DEFAULT_PLUGIN_QUANTUM {
                output.push(processor.process(0.1, 0.1).0);
            }
            thread::sleep(block_duration);
        }
        let tail = &output[output.len() - 2048..];
        let rms =
            (tail.iter().map(|sample| sample * sample).sum::<f32>() / tail.len() as f32).sqrt();
        assert!(
            (0.03..0.1).contains(&(rms / 0.1)),
            "live parameter update should reduce gain, got {}",
            rms / 0.1
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn plugin_without_native_gui_reports_the_editor_error_without_killing_the_insert() {
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
            eprintln!("SKIP: build and stage OpenBeats Gain and the CLAP helper first");
            return;
        }

        let processor = PluginProcessor::launch(
            &helper,
            "studio.openbeats.gain",
            48_000.0,
            DEFAULT_PLUGIN_QUANTUM,
            None,
        )
        .expect("the proof CLAP plugin should load for GUI testing");
        let error = processor
            .set_gui_open(true, None)
            .expect_err("OpenBeats Gain does not expose a native GUI");
        assert!(
            error.contains("does not provide the CLAP GUI extension"),
            "{error}"
        );
        assert!(
            !processor.is_failed(),
            "an unsupported GUI must not mark the audio insert as failed"
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn hung_plugin_helper_is_killed_and_live_processing_uses_delayed_dry_audio() {
        use std::os::unix::fs::PermissionsExt;

        let helper = std::env::temp_dir().join(format!(
            "openbeats-hanging-clap-helper-{}",
            std::process::id()
        ));
        std::fs::write(
            &helper,
            "#!/bin/sh\nIFS= read -r command\nprintf 'READY 0\\n'\nIFS= read -r command\nprintf 'PARAMS []\\n'\nIFS= read -r command\nsleep 30\n",
        )
        .expect("write the hanging helper fixture");
        let mut permissions = std::fs::metadata(&helper)
            .expect("read helper fixture metadata")
            .permissions();
        permissions.set_mode(0o700);
        std::fs::set_permissions(&helper, permissions).expect("make helper executable");

        let mut processor = PluginProcessor::launch(
            &helper,
            "test.hanging.plugin",
            48_000.0,
            DEFAULT_PLUGIN_QUANTUM,
            None,
        )
        .expect("the fake helper should load before hanging during processing");
        for _ in 0..DEFAULT_PLUGIN_QUANTUM * 2 {
            processor.process(0.1, 0.1);
        }

        let deadline = Instant::now() + CONTROL_TIMEOUT + Duration::from_secs(2);
        while !processor.is_failed() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        assert!(
            processor.is_failed(),
            "watchdog should detect the hung helper"
        );

        let mut output = Vec::new();
        for _ in 0..processor.latency_frames() + 512 {
            output.push(processor.process(0.25, 0.25).0);
        }
        assert!(
            output[output.len() - 512..]
                .iter()
                .all(|sample| (*sample - 0.25).abs() < f32::EPSILON),
            "the failed plugin should fall back to delayed dry audio"
        );
        drop(processor);
        std::fs::remove_file(helper).expect("remove the hanging helper fixture");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn offline_processing_waits_for_complete_blocks_and_discards_padding() {
        let (mut processor, mut worker) = PluginProcessor::pair(16, 0);
        worker.mark_ready();
        let worker_thread = thread::spawn(move || {
            let mut block = Vec::with_capacity(16);
            while !worker.is_shutdown() {
                if let Some(mut frame) = worker.try_pop_input() {
                    frame.left *= 0.5;
                    frame.right *= 0.5;
                    block.push(frame);
                    if block.len() == 16 {
                        for frame in block.drain(..) {
                            assert!(worker.try_push_output(frame));
                        }
                    }
                } else {
                    thread::sleep(Duration::from_micros(250));
                }
            }
        });
        let input: Vec<_> = (0..20)
            .map(|frame| (frame as f32, -(frame as f32)))
            .collect();

        let output = processor.process_offline_samples(&input).unwrap();
        assert_eq!(
            output,
            input
                .iter()
                .map(|(left, right)| (left * 0.5, right * 0.5))
                .collect::<Vec<_>>()
        );
        drop(processor);
        worker_thread.join().unwrap();
    }

    #[test]
    fn failed_processor_falls_back_to_latency_matched_dry_audio() {
        let (mut processor, worker) = PluginProcessor::pair(16, 0);
        worker.mark_failed();
        for sequence in 0..64 {
            let output = processor.process(sequence as f32, 0.0);
            if sequence >= 32 {
                assert_eq!(output.0, (sequence - 32) as f32);
            } else {
                assert_eq!(output.0, 0.0);
            }
        }
    }
}
