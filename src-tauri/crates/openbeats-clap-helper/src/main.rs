//! Linux-only out-of-process CLAP host.
//!
//! The process owns the plugin and its audio thread. The Tauri app only speaks a
//! small line protocol over stdin/stdout, so a plugin crash cannot take down the
//! UI. This binary is staged as a Tauri `externalBin` and is never compiled into
//! the Windows/macOS `plughost` path.

#[cfg(target_os = "linux")]
mod linux {
    use std::collections::{HashMap, HashSet};
    use std::ffi::CString;
    use std::fs;
    use std::io::{self, BufRead, Read, Write};
    use std::path::{Path, PathBuf};
    use std::sync::mpsc::{self, Receiver, Sender};

    use clack_host::events::io::EventBuffer;
    use clack_host::prelude::*;

    const SAMPLE_RATE: f64 = 48_000.0;
    const MAX_FRAMES: usize = 4096;
    const CHANNELS: usize = 2;

    struct HostShared;

    impl<'a> SharedHandler<'a> for HostShared {
        fn request_restart(&self) {}
        fn request_process(&self) {}
        fn request_callback(&self) {}
    }

    struct Host;

    impl HostHandlers for Host {
        type Shared<'a> = HostShared;
        type MainThread<'a> = ();
        type AudioProcessor<'a> = ();
    }

    struct HostedPlugin {
        // Drop order matters: fields drop in declaration order. The processor
        // must stop before the instance, and the entry must outlive both.
        processor: StartedPluginAudioProcessor<Host>,
        _instance: PluginInstance<Host>,
        _entry: PluginEntry,
    }

    enum Request {
        Load {
            path: PathBuf,
            id: String,
            reply: Sender<Result<(), String>>,
        },
        Process {
            frames: usize,
            audio: Vec<u8>,
            reply: Sender<Result<Vec<u8>, String>>,
        },
        Quit,
    }

    fn plugin_roots() -> Vec<PathBuf> {
        let mut roots = Vec::new();
        if let Some(home) = std::env::var_os("HOME") {
            roots.push(PathBuf::from(home).join(".clap"));
        }
        roots.push(PathBuf::from("/usr/lib/clap"));
        roots.push(PathBuf::from("/usr/local/lib/clap"));
        if let Some(path) = std::env::var_os("CLAP_PATH") {
            roots.extend(std::env::split_paths(&path));
        }
        roots
    }

    fn is_bundle(path: &Path) -> bool {
        path.is_dir()
            || path
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("clap"))
    }

    struct ScannedPlugin {
        path: PathBuf,
        id: String,
        name: String,
        vendor: String,
    }

    fn scan() -> Vec<ScannedPlugin> {
        let mut found = Vec::new();
        let mut seen = HashSet::new();

        for root in plugin_roots() {
            let Ok(entries) = fs::read_dir(&root) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if !is_bundle(&path) {
                    continue;
                }
                let Ok(plugin_entry) = (unsafe { PluginEntry::load(&path) }) else {
                    continue;
                };
                let Some(factory) = plugin_entry.get_plugin_factory() else {
                    continue;
                };
                for descriptor in factory.plugin_descriptors() {
                    let Some(id) = descriptor.id() else {
                        continue;
                    };
                    let id = id.to_bytes();
                    let key = (path.clone(), id.to_vec());
                    if !seen.insert(key) {
                        continue;
                    }
                    let name = descriptor
                        .name()
                        .map(|value| value.to_string_lossy().into_owned())
                        .unwrap_or_default();
                    let vendor = descriptor
                        .vendor()
                        .map(|value| value.to_string_lossy().into_owned())
                        .unwrap_or_default();
                    found.push(ScannedPlugin {
                        path: path.clone(),
                        id: String::from_utf8_lossy(id).into_owned(),
                        name,
                        vendor,
                    });
                }
            }
        }
        found
    }

    fn host_info() -> Result<HostInfo, String> {
        HostInfo::new(
            "OpenBeats CLAP Helper",
            "OpenBeats",
            "https://github.com/blsphmicwillow/OpenBeats",
            env!("CARGO_PKG_VERSION"),
        )
        .map_err(|error| error.to_string())
    }

    fn load(path: &Path, id: &str) -> Result<HostedPlugin, String> {
        let entry = unsafe { PluginEntry::load(path) }.map_err(|error| error.to_string())?;
        let plugin_id =
            CString::new(id).map_err(|_| "plugin id contains a NUL byte".to_string())?;
        let host = host_info()?;
        let mut instance =
            PluginInstance::<Host>::new(|_| HostShared, |_| (), &entry, &plugin_id, &host)
                .map_err(|error| error.to_string())?;

        let configuration = PluginAudioConfiguration {
            sample_rate: SAMPLE_RATE,
            min_frames_count: 1,
            max_frames_count: MAX_FRAMES as u32,
        };
        let stopped = instance
            .activate(|_, _| (), configuration)
            .map_err(|error| error.to_string())?;
        let processor = stopped
            .start_processing()
            .map_err(|error| error.to_string())?;

        Ok(HostedPlugin {
            processor,
            _instance: instance,
            _entry: entry,
        })
    }

    fn process(hosted: &mut HostedPlugin, frames: usize, bytes: &[u8]) -> Result<Vec<u8>, String> {
        if frames == 0 || frames > MAX_FRAMES {
            return Err(format!("frame count must be 1..={MAX_FRAMES}"));
        }
        let expected = frames * CHANNELS * std::mem::size_of::<f32>();
        if bytes.len() != expected {
            return Err(format!(
                "expected {expected} bytes for {frames} stereo frames, got {}",
                bytes.len()
            ));
        }

        let mut left = vec![0.0f32; frames];
        let mut right = vec![0.0f32; frames];
        for frame in 0..frames {
            let offset = frame * CHANNELS * 4;
            left[frame] = f32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap());
            right[frame] = f32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap());
        }

        let mut output_left = vec![0.0f32; frames];
        let mut output_right = vec![0.0f32; frames];
        let mut input_ports = AudioPorts::with_capacity(CHANNELS, 1);
        let mut output_ports = AudioPorts::with_capacity(CHANNELS, 1);

        let input_audio = input_ports.with_input_buffers([AudioPortBuffer {
            latency: 0,
            channels: AudioPortBufferType::f32_input_only(
                [left.as_mut_slice(), right.as_mut_slice()]
                    .into_iter()
                    .map(InputChannel::variable),
            ),
        }]);
        let mut output_audio = output_ports.with_output_buffers([AudioPortBuffer {
            latency: 0,
            channels: AudioPortBufferType::f32_output_only(
                [output_left.as_mut_slice(), output_right.as_mut_slice()].into_iter(),
            ),
        }]);

        let input_events = EventBuffer::new();
        let mut output_events = EventBuffer::new();
        let input_events = InputEvents::from_buffer(&input_events);
        let mut output_events = OutputEvents::from_buffer(&mut output_events);

        hosted
            .processor
            .process(
                &input_audio,
                &mut output_audio,
                &input_events,
                &mut output_events,
                Some(frames as u64),
                None,
            )
            .map_err(|error| error.to_string())?;

        let mut output = Vec::with_capacity(expected);
        for frame in 0..frames {
            output.extend_from_slice(&output_left[frame].to_le_bytes());
            output.extend_from_slice(&output_right[frame].to_le_bytes());
        }
        Ok(output)
    }

    fn audio_thread(receiver: Receiver<Request>) {
        let mut hosted: Option<HostedPlugin> = None;
        while let Ok(request) = receiver.recv() {
            match request {
                Request::Load { path, id, reply } => {
                    let result = load(&path, &id).map(|loaded| {
                        hosted = Some(loaded);
                    });
                    let _ = reply.send(result);
                }
                Request::Process {
                    frames,
                    audio,
                    reply,
                } => {
                    let result = match hosted.as_mut() {
                        Some(plugin) => process(plugin, frames, &audio),
                        None => Err("no plugin loaded".to_string()),
                    };
                    let _ = reply.send(result);
                }
                Request::Quit => break,
            }
        }
    }

    fn write_error(message: &str) {
        println!("ERROR {message}");
        let _ = io::stdout().flush();
    }

    pub fn main() {
        let (sender, receiver) = mpsc::channel();
        let audio = std::thread::Builder::new()
            .name("openbeats-clap-audio".to_string())
            .spawn(move || audio_thread(receiver));
        let audio = match audio {
            Ok(handle) => handle,
            Err(error) => {
                write_error(&format!("could not start audio thread: {error}"));
                std::process::exit(1);
            }
        };

        let stdin = io::stdin();
        let mut input = stdin.lock();
        let mut line = String::new();
        let mut scanned: HashMap<String, PathBuf> = HashMap::new();
        loop {
            line.clear();
            match input.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => {}
                Err(error) => {
                    write_error(&format!("stdin: {error}"));
                    break;
                }
            }
            let command = line.trim_end_matches(['\r', '\n']);
            if command == "SCAN" {
                let plugins = scan();
                scanned.clear();
                for plugin in &plugins {
                    scanned
                        .entry(plugin.id.clone())
                        .or_insert_with(|| plugin.path.clone());
                }
                println!("SCAN {}", plugins.len());
                for plugin in plugins {
                    println!("{}\t{}\t{}", plugin.id, plugin.name, plugin.vendor);
                }
                let _ = io::stdout().flush();
            } else if let Some(rest) = command.strip_prefix("LOAD ") {
                // LOAD <id> is the public protocol. LOAD <path>\t<id> is kept
                // for direct probes and tests.
                let (path, id) = match rest.split_once('\t') {
                    Some((path, id)) => (PathBuf::from(path), id.to_string()),
                    None => {
                        let id = rest.trim();
                        let Some(path) = scanned.get(id).cloned() else {
                            write_error(&format!("plugin {id} was not found; run SCAN first"));
                            continue;
                        };
                        (path, id.to_string())
                    }
                };
                let (reply, response) = mpsc::channel();
                if sender.send(Request::Load { path, id, reply }).is_err() {
                    write_error("audio thread is gone");
                    break;
                }
                match response.recv() {
                    Ok(Ok(())) => {
                        println!("READY");
                        let _ = io::stdout().flush();
                    }
                    Ok(Err(error)) => write_error(&error),
                    Err(_) => {
                        write_error("audio thread stopped");
                        break;
                    }
                }
            } else if let Some(rest) = command.strip_prefix("PROCESS ") {
                let Ok(frames) = rest.parse::<usize>() else {
                    write_error("PROCESS requires a frame count");
                    continue;
                };
                if frames == 0 || frames > MAX_FRAMES {
                    write_error(&format!("frame count must be 1..={MAX_FRAMES}"));
                    continue;
                }
                let byte_count = frames * CHANNELS * std::mem::size_of::<f32>();
                let mut audio = vec![0u8; byte_count];
                if let Err(error) = input.read_exact(&mut audio) {
                    write_error(&format!("audio bytes: {error}"));
                    break;
                }
                let (reply, response) = mpsc::channel();
                if sender
                    .send(Request::Process {
                        frames,
                        audio,
                        reply,
                    })
                    .is_err()
                {
                    write_error("audio thread is gone");
                    break;
                }
                match response.recv() {
                    Ok(Ok(audio)) => {
                        println!("PROCESSED {}", frames);
                        let mut stdout = io::stdout();
                        let _ = stdout.write_all(&audio);
                        let _ = stdout.flush();
                    }
                    Ok(Err(error)) => write_error(&error),
                    Err(_) => {
                        write_error("audio thread stopped");
                        break;
                    }
                }
            } else if command == "QUIT" {
                let _ = sender.send(Request::Quit);
                break;
            } else if !command.is_empty() {
                write_error(&format!("unknown command: {command}"));
            }
        }

        let _ = sender.send(Request::Quit);
        let _ = audio.join();
    }
}

#[cfg(target_os = "linux")]
fn main() {
    linux::main();
}

#[cfg(not(target_os = "linux"))]
fn main() {
    eprintln!("openbeats-clap-helper is only built for Linux");
    std::process::exit(78);
}
