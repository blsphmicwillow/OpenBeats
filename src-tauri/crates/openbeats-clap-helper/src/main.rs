//! Linux-only out-of-process CLAP host.
//!
//! The process owns the plugin and its audio thread. The Tauri app only speaks a
//! small line protocol over stdin/stdout, so a plugin crash cannot take down the
//! UI. This binary is staged as a Tauri `externalBin` and is never compiled into
//! the Windows/macOS `plughost` path.

#[cfg(target_os = "linux")]
mod linux {
    use std::collections::{HashMap, HashSet};
    use std::ffi::{c_ulong, c_void, CString};
    use std::fs;
    use std::io::{self, BufRead, Read, Write};
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::sync::mpsc::{self, Receiver, Sender};
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    use clack_extensions::gui::{GuiApiType, GuiConfiguration, HostGui, HostGuiImpl, PluginGui};
    use clack_extensions::timer::{HostTimer, HostTimerImpl, TimerId};
    use clack_host::events::event_types::ParamValueEvent;
    use clack_host::events::io::EventBuffer;
    use clack_host::prelude::*;
    use clack_host::utils::ClapId;

    const MAX_FRAMES: usize = 4096;
    const MAX_STATE_BYTES: usize = 64 * 1024 * 1024;
    const CHANNELS: usize = 2;

    #[derive(Default)]
    struct HostShared {
        callback_requested: AtomicBool,
        show_requested: AtomicBool,
        hide_requested: AtomicBool,
        closed: AtomicBool,
        destroyed: AtomicBool,
        timers: Mutex<HashMap<u32, RegisteredTimer>>,
        next_timer_id: AtomicU32,
    }

    struct RegisteredTimer {
        period: Duration,
        next_tick: Instant,
    }

    struct HostMainThread<'a> {
        shared: &'a HostShared,
    }

    impl<'a> SharedHandler<'a> for HostShared {
        fn request_restart(&self) {}
        fn request_process(&self) {}
        fn request_callback(&self) {
            self.callback_requested.store(true, Ordering::Release);
        }
    }

    impl HostGuiImpl for HostShared {
        fn resize_hints_changed(&self) {}

        fn request_resize(
            &self,
            _new_size: clack_extensions::gui::GuiSize,
        ) -> Result<(), HostError> {
            Ok(())
        }

        fn request_show(&self) -> Result<(), HostError> {
            self.show_requested.store(true, Ordering::Release);
            Ok(())
        }

        fn request_hide(&self) -> Result<(), HostError> {
            self.hide_requested.store(true, Ordering::Release);
            Ok(())
        }

        fn closed(&self, was_destroyed: bool) {
            self.closed.store(true, Ordering::Release);
            self.destroyed.store(was_destroyed, Ordering::Release);
        }
    }

    impl<'a> MainThreadHandler<'a> for HostMainThread<'a> {}

    impl HostTimerImpl for HostMainThread<'_> {
        fn register_timer(&self, period_ms: u32) -> Result<TimerId, HostError> {
            if period_ms == 0 {
                return Err(HostError::Message("CLAP timer period must be positive"));
            }
            let period = Duration::from_millis(u64::from(period_ms.max(33)));
            let next_tick = Instant::now()
                .checked_add(period)
                .ok_or(HostError::Message("CLAP timer period is too large"))?;
            let mut timers = self
                .shared
                .timers
                .lock()
                .map_err(|_| HostError::Message("CLAP timer registry is unavailable"))?;
            let timer_id = loop {
                let id = self.shared.next_timer_id.fetch_add(1, Ordering::Relaxed);
                if !timers.contains_key(&id) {
                    break id;
                }
            };
            timers.insert(
                timer_id,
                RegisteredTimer {
                    period,
                    next_tick,
                },
            );
            Ok(TimerId(timer_id))
        }

        fn unregister_timer(&self, timer_id: TimerId) -> Result<(), HostError> {
            self.shared
                .timers
                .lock()
                .map_err(|_| HostError::Message("CLAP timer registry is unavailable"))?
                .remove(&timer_id.0)
                .map(|_| ())
                .ok_or(HostError::Message("CLAP timer id is not registered"))
        }
    }

    struct Host;

    impl HostHandlers for Host {
        type Shared<'a> = HostShared;
        type MainThread<'a> = HostMainThread<'a>;
        type AudioProcessor<'a> = ();

        fn declare_extensions(builder: &mut HostExtensions<Self>, _shared: &Self::Shared<'_>) {
            builder.register::<HostGui>().register::<HostTimer>();
        }
    }

    struct HostedPlugin {
        // Drop order matters: fields drop in declaration order. The processor
        // must stop before the instance, and the entry must outlive both.
        processor: StartedPluginAudioProcessor<Host>,
        instance: PluginInstance<Host>,
        _entry: PluginEntry,
        max_frames: usize,
        latency: u32,
        parameters: Vec<ClapParameter>,
        pending_parameters: Vec<(u32, f64)>,
        gui: Option<PluginGui>,
        gui_visible: bool,
        name: String,
    }

    #[derive(Clone, Debug, serde::Serialize)]
    struct ClapParameter {
        id: u32,
        name: String,
        module: String,
        min_value: f64,
        max_value: f64,
        default_value: f64,
        value: f64,
        readonly: bool,
        hidden: bool,
        stepped: bool,
    }

    enum Request {
        Load {
            path: PathBuf,
            id: String,
            sample_rate: f64,
            max_frames: usize,
            state: Option<Vec<u8>>,
            reply: Sender<Result<u32, String>>,
        },
        Process {
            frames: usize,
            audio: Vec<u8>,
            reply: Sender<Result<Vec<u8>, String>>,
        },
        SaveState {
            reply: Sender<Result<Option<Vec<u8>>, String>>,
        },
        GetParameters {
            reply: Sender<Result<Vec<ClapParameter>, String>>,
        },
        SetParameter {
            id: u32,
            value: f64,
            reply: Sender<Result<(), String>>,
        },
        OpenGui {
            parent_x11: Option<u64>,
            reply: Sender<Result<(), String>>,
        },
        CloseGui {
            reply: Sender<Result<(), String>>,
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

    struct StateReader {
        bytes: Vec<u8>,
        position: usize,
    }

    unsafe extern "C" fn write_state(
        stream: *const clap_sys::stream::clap_ostream,
        buffer: *const c_void,
        size: u64,
    ) -> i64 {
        if stream.is_null() || size > usize::MAX as u64 {
            return -1;
        }
        let stream = unsafe { &*stream };
        if stream.ctx.is_null() {
            return -1;
        }
        let output = unsafe { &mut *(stream.ctx as *mut Vec<u8>) };
        let size = size as usize;
        if output.len().saturating_add(size) > MAX_STATE_BYTES {
            return -1;
        }
        if size == 0 {
            return 0;
        }
        if buffer.is_null() {
            return -1;
        }
        let bytes = unsafe { std::slice::from_raw_parts(buffer as *const u8, size) };
        output.extend_from_slice(bytes);
        i64::try_from(size).unwrap_or(-1)
    }

    unsafe extern "C" fn read_state(
        stream: *const clap_sys::stream::clap_istream,
        buffer: *mut c_void,
        size: u64,
    ) -> i64 {
        if stream.is_null() || size > usize::MAX as u64 {
            return -1;
        }
        let stream = unsafe { &*stream };
        if stream.ctx.is_null() {
            return -1;
        }
        let input = unsafe { &mut *(stream.ctx as *mut StateReader) };
        let size = (size as usize).min(input.bytes.len().saturating_sub(input.position));
        if size == 0 {
            return 0;
        }
        if buffer.is_null() {
            return -1;
        }
        let output = unsafe { std::slice::from_raw_parts_mut(buffer as *mut u8, size) };
        output.copy_from_slice(&input.bytes[input.position..input.position + size]);
        input.position += size;
        i64::try_from(size).unwrap_or(-1)
    }

    fn plugin_state_extension(
        plugin: &clap_sys::plugin::clap_plugin,
    ) -> Result<clap_sys::ext::state::clap_plugin_state, String> {
        let get_extension = plugin
            .get_extension
            .ok_or_else(|| "plugin does not expose CLAP extensions".to_string())?;
        let extension =
            unsafe { get_extension(plugin, clap_sys::ext::state::CLAP_EXT_STATE.as_ptr()) };
        if extension.is_null() {
            return Err("plugin does not support the CLAP state extension".to_string());
        }
        Ok(unsafe { *(extension as *const clap_sys::ext::state::clap_plugin_state) })
    }

    fn optional_state_extension(
        plugin: &clap_sys::plugin::clap_plugin,
    ) -> Option<clap_sys::ext::state::clap_plugin_state> {
        let get_extension = plugin.get_extension?;
        let extension =
            unsafe { get_extension(plugin, clap_sys::ext::state::CLAP_EXT_STATE.as_ptr()) };
        if extension.is_null() {
            None
        } else {
            Some(unsafe { *(extension as *const clap_sys::ext::state::clap_plugin_state) })
        }
    }

    fn clap_string<const N: usize>(value: &[std::ffi::c_char; N]) -> String {
        let bytes = value
            .iter()
            .take_while(|character| **character != 0)
            .map(|character| *character as u8)
            .collect::<Vec<_>>();
        String::from_utf8_lossy(&bytes).into_owned()
    }

    fn plugin_parameters(
        plugin: &clap_sys::plugin::clap_plugin,
    ) -> Result<Vec<ClapParameter>, String> {
        let Some(get_extension) = plugin.get_extension else {
            return Ok(Vec::new());
        };
        let extension =
            unsafe { get_extension(plugin, clap_sys::ext::params::CLAP_EXT_PARAMS.as_ptr()) };
        if extension.is_null() {
            return Ok(Vec::new());
        }
        let extension =
            unsafe { &*(extension as *const clap_sys::ext::params::clap_plugin_params) };
        let count = extension
            .count
            .ok_or_else(|| "plugin has an incomplete CLAP parameters extension".to_string())?;
        let get_info = extension
            .get_info
            .ok_or_else(|| "plugin has an incomplete CLAP parameters extension".to_string())?;
        let get_value = extension
            .get_value
            .ok_or_else(|| "plugin has an incomplete CLAP parameters extension".to_string())?;
        let count = unsafe { count(plugin) };
        if count > 4096 {
            return Err("plugin exposes more than 4096 parameters".to_string());
        }

        let mut parameters = Vec::with_capacity(count as usize);
        for index in 0..count {
            let mut info = unsafe { std::mem::zeroed::<clap_sys::ext::params::clap_param_info>() };
            if !unsafe { get_info(plugin, index, &mut info) } {
                return Err(format!("plugin could not describe parameter {index}"));
            }
            if info.id == u32::MAX {
                continue;
            }
            if !info.min_value.is_finite()
                || !info.max_value.is_finite()
                || info.min_value > info.max_value
            {
                return Err(format!(
                    "plugin returned an invalid range for parameter {}",
                    info.id
                ));
            }
            let mut value = info.default_value;
            if !unsafe { get_value(plugin, info.id, &mut value) } {
                return Err(format!("plugin could not read parameter {}", info.id));
            }
            if !value.is_finite() {
                return Err(format!(
                    "plugin returned an invalid value for parameter {}",
                    info.id
                ));
            }
            parameters.push(ClapParameter {
                id: info.id,
                name: clap_string(&info.name),
                module: clap_string(&info.module),
                min_value: info.min_value,
                max_value: info.max_value,
                default_value: info.default_value,
                value,
                readonly: info.flags & clap_sys::ext::params::CLAP_PARAM_IS_READONLY != 0,
                hidden: info.flags & clap_sys::ext::params::CLAP_PARAM_IS_HIDDEN != 0,
                stepped: info.flags & clap_sys::ext::params::CLAP_PARAM_IS_STEPPED != 0,
            });
        }
        Ok(parameters)
    }

    fn queue_parameter(hosted: &mut HostedPlugin, id: u32, value: f64) -> Result<(), String> {
        if !value.is_finite() {
            return Err("parameter value must be finite".to_string());
        }
        let parameter = hosted
            .parameters
            .iter()
            .find(|parameter| parameter.id == id)
            .ok_or_else(|| format!("plugin does not expose parameter {id}"))?;
        if parameter.readonly {
            return Err(format!("plugin parameter {id} is read-only"));
        }
        if value < parameter.min_value || value > parameter.max_value {
            return Err(format!(
                "parameter {id} must be between {} and {}",
                parameter.min_value, parameter.max_value
            ));
        }
        if let Some((_, pending_value)) = hosted
            .pending_parameters
            .iter_mut()
            .find(|(pending_id, _)| *pending_id == id)
        {
            *pending_value = value;
        } else {
            hosted.pending_parameters.push((id, value));
        }
        Ok(())
    }

    fn restore_state(instance: &PluginInstance<Host>, bytes: &[u8]) -> Result<(), String> {
        if bytes.len() > MAX_STATE_BYTES {
            return Err(format!(
                "plugin state exceeds the {MAX_STATE_BYTES}-byte limit"
            ));
        }
        let plugin = instance.raw_instance();
        let extension = plugin_state_extension(plugin)?;
        let load = extension
            .load
            .ok_or_else(|| "plugin does not implement CLAP state loading".to_string())?;
        let mut reader = StateReader {
            bytes: bytes.to_vec(),
            position: 0,
        };
        let stream = clap_sys::stream::clap_istream {
            ctx: &mut reader as *mut StateReader as *mut c_void,
            read: Some(read_state),
        };
        if unsafe { load(plugin, &stream) } {
            Ok(())
        } else {
            Err("plugin rejected its saved CLAP state".to_string())
        }
    }

    fn load(
        path: &Path,
        id: &str,
        sample_rate: f64,
        max_frames: usize,
        state: Option<&[u8]>,
    ) -> Result<HostedPlugin, String> {
        if !sample_rate.is_finite() || sample_rate <= 0.0 {
            return Err("sample rate must be a positive finite number".to_string());
        }
        if max_frames == 0 || max_frames > MAX_FRAMES {
            return Err(format!("block size must be 1..={MAX_FRAMES}"));
        }
        let entry = unsafe { PluginEntry::load(path) }.map_err(|error| error.to_string())?;
        let plugin_id =
            CString::new(id).map_err(|_| "plugin id contains a NUL byte".to_string())?;
        let host = host_info()?;
        let mut instance = PluginInstance::<Host>::new(
            |_| HostShared::default(),
            |shared| HostMainThread { shared },
            &entry,
            &plugin_id,
            &host,
        )
        .map_err(|error| error.to_string())?;
        if let Some(state) = state {
            restore_state(&instance, state)?;
        }

        let configuration = PluginAudioConfiguration {
            sample_rate,
            min_frames_count: 1,
            max_frames_count: max_frames as u32,
        };
        let stopped = instance
            .activate(|_, _| (), configuration)
            .map_err(|error| error.to_string())?;
        let processor = stopped
            .start_processing()
            .map_err(|error| error.to_string())?;

        let plugin = instance.raw_instance();
        let latency = plugin
            .get_extension
            .and_then(|get_extension| {
                let extension = unsafe {
                    get_extension(plugin, clap_sys::ext::latency::CLAP_EXT_LATENCY.as_ptr())
                };
                (!extension.is_null()).then(|| {
                    let extension = unsafe {
                        &*(extension as *const clap_sys::ext::latency::clap_plugin_latency)
                    };
                    extension.get.map(|get| unsafe { get(plugin) }).unwrap_or(0)
                })
            })
            .unwrap_or(0);
        let parameters = plugin_parameters(plugin)?;

        Ok(HostedPlugin {
            processor,
            instance,
            _entry: entry,
            max_frames,
            latency,
            parameters,
            pending_parameters: Vec::new(),
            gui: None,
            gui_visible: false,
            name: id.to_string(),
        })
    }

    fn open_gui(hosted: &mut HostedPlugin, parent_x11: Option<u64>) -> Result<(), String> {
        let gui = hosted
            .instance
            .plugin_shared_handle()
            .get_extension::<PluginGui>()
            .ok_or_else(|| "plugin does not provide the CLAP GUI extension".to_string())?;
        let handle = hosted.instance.plugin_handle();

        if hosted.gui_visible {
            return Ok(());
        }
        if let Some(gui) = hosted.gui {
            gui.show(&handle).map_err(|error| error.to_string())?;
            hosted.gui_visible = true;
            return Ok(());
        }

        let preferred = gui
            .get_preferred_api(&handle)
            .and_then(|configuration| configuration.api_type.to_standard_api());
        let mut apis = Vec::with_capacity(3);
        if parent_x11.is_some() {
            apis.push(GuiApiType::X11);
        }
        if let Some(api) = preferred {
            if !apis.contains(&api) {
                apis.push(api);
            }
        }
        for api in [GuiApiType::X11, GuiApiType::WAYLAND] {
            if !apis.contains(&api) {
                apis.push(api);
            }
        }
        let configuration = apis
            .into_iter()
            .map(|api_type| GuiConfiguration {
                api_type,
                is_floating: true,
            })
            .find(|configuration| gui.is_api_supported(&handle, *configuration))
            .ok_or_else(|| {
                "plugin has no supported floating GUI on this Linux session".to_string()
            })?;

        gui.create(&handle, configuration)
            .map_err(|error| error.to_string())?;
        if configuration.api_type == GuiApiType::X11 {
            if let Some(parent_x11) = parent_x11 {
                let parent = clack_extensions::gui::Window::from_x11_handle(parent_x11 as c_ulong);
                if let Err(error) = unsafe { gui.set_transient(&handle, parent) } {
                    gui.destroy(&handle);
                    return Err(error.to_string());
                }
            }
        }
        let title = CString::new(format!("{} - OpenBeats", hosted.name))
            .map_err(|_| "plugin name contains a NUL byte".to_string())?;
        gui.suggest_title(&handle, &title);
        if let Err(error) = gui.show(&handle) {
            gui.destroy(&handle);
            return Err(error.to_string());
        }
        hosted.gui = Some(gui);
        hosted.gui_visible = true;
        Ok(())
    }

    fn close_gui(hosted: &mut HostedPlugin) -> Result<(), String> {
        let Some(gui) = hosted.gui else {
            return Ok(());
        };
        gui.hide(&hosted.instance.plugin_handle())
            .map_err(|error| error.to_string())?;
        hosted.gui_visible = false;
        Ok(())
    }

    fn destroy_gui(hosted: &mut HostedPlugin) {
        if let Some(gui) = hosted.gui.take() {
            gui.destroy(&hosted.instance.plugin_handle());
        }
        hosted.gui_visible = false;
    }

    fn service_main_thread(hosted: &mut HostedPlugin) -> Result<(), String> {
        let (callback, show, hide, destroyed) = hosted.instance.access_shared_handler(|shared| {
            (
                shared.callback_requested.swap(false, Ordering::AcqRel),
                shared.show_requested.swap(false, Ordering::AcqRel),
                shared.hide_requested.swap(false, Ordering::AcqRel),
                shared.destroyed.swap(false, Ordering::AcqRel),
            )
        });
        let closed = hosted
            .instance
            .access_shared_handler(|shared| shared.closed.swap(false, Ordering::AcqRel));
        if closed {
            hosted.gui_visible = false;
        }
        if callback {
            hosted.instance.call_on_main_thread_callback();
        }
        if destroyed {
            if let Some(gui) = hosted.gui.take() {
                gui.destroy(&hosted.instance.plugin_handle());
            }
            hosted.gui_visible = false;
        }
        if show {
            open_gui(hosted, None)?;
        }
        if hide {
            close_gui(hosted)?;
        }
        service_timers(hosted)?;
        Ok(())
    }

    fn service_timers(hosted: &mut HostedPlugin) -> Result<(), String> {
        let due_timers = hosted.instance.access_shared_handler(|shared| {
            let mut timers = shared
                .timers
                .lock()
                .map_err(|_| "CLAP timer registry is unavailable".to_string())?;
            let now = Instant::now();
            let mut due = Vec::new();
            for (id, timer) in timers.iter_mut() {
                if now >= timer.next_tick {
                    timer.next_tick = now
                        .checked_add(timer.period)
                        .ok_or_else(|| "CLAP timer deadline is out of range".to_string())?;
                    due.push(*id);
                }
            }
            Ok::<_, String>(due)
        })?;
        if due_timers.is_empty() {
            return Ok(());
        }

        let plugin = hosted.instance.raw_instance();
        let get_extension = plugin
            .get_extension
            .ok_or_else(|| "plugin has no CLAP extension lookup".to_string())?;
        let extension = unsafe {
            get_extension(
                plugin,
                clap_sys::ext::timer_support::CLAP_EXT_TIMER_SUPPORT.as_ptr(),
            )
        };
        if extension.is_null() {
            return Err("plugin registered a timer but has no timer callback extension".to_string());
        }
        let extension =
            unsafe { &*(extension as *const clap_sys::ext::timer_support::clap_plugin_timer_support) };
        let on_timer = extension
            .on_timer
            .ok_or_else(|| "plugin has an incomplete CLAP timer extension".to_string())?;
        for timer_id in due_timers {
            unsafe { on_timer(plugin, timer_id) };
        }
        Ok(())
    }

    fn save_state(hosted: &HostedPlugin) -> Result<Option<Vec<u8>>, String> {
        let plugin = hosted.instance.raw_instance();
        let Some(extension) = optional_state_extension(plugin) else {
            return Ok(None);
        };
        let Some(save) = extension.save else {
            return Ok(None);
        };
        let mut bytes = Vec::new();
        let stream = clap_sys::stream::clap_ostream {
            ctx: &mut bytes as *mut Vec<u8> as *mut c_void,
            write: Some(write_state),
        };
        if unsafe { save(plugin, &stream) } {
            Ok(Some(bytes))
        } else {
            Err("plugin could not save its CLAP state".to_string())
        }
    }

    fn process(hosted: &mut HostedPlugin, frames: usize, bytes: &[u8]) -> Result<Vec<u8>, String> {
        if frames == 0 || frames > hosted.max_frames {
            return Err(format!("frame count must be 1..={}", hosted.max_frames));
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

        let mut parameter_events = EventBuffer::with_capacity(hosted.pending_parameters.len());
        for (id, value) in &hosted.pending_parameters {
            let event = ParamValueEvent::new(0, ClapId::new(*id), Pckn::match_all(), *value);
            parameter_events.push(&event);
        }
        let input_events = parameter_events.as_input();
        let mut output_events = EventBuffer::new();
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
        hosted.pending_parameters.clear();

        let mut output = Vec::with_capacity(expected);
        for frame in 0..frames {
            output.extend_from_slice(&output_left[frame].to_le_bytes());
            output.extend_from_slice(&output_right[frame].to_le_bytes());
        }
        Ok(output)
    }

    fn audio_thread(receiver: Receiver<Request>) {
        let mut hosted: Option<HostedPlugin> = None;
        loop {
            if let Some(plugin) = hosted.as_mut() {
                let _ = service_main_thread(plugin);
            }
            let request = match receiver.recv_timeout(std::time::Duration::from_millis(10)) {
                Ok(request) => request,
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            };
            match request {
                Request::Load {
                    path,
                    id,
                    sample_rate,
                    max_frames,
                    state,
                    reply,
                } => {
                    if let Some(plugin) = hosted.as_mut() {
                        destroy_gui(plugin);
                    }
                    let result =
                        load(&path, &id, sample_rate, max_frames, state.as_deref()).map(|loaded| {
                            let latency = loaded.latency;
                            hosted = Some(loaded);
                            latency
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
                Request::SaveState { reply } => {
                    let result = hosted
                        .as_ref()
                        .ok_or_else(|| "no plugin loaded".to_string())
                        .and_then(save_state);
                    let _ = reply.send(result);
                }
                Request::GetParameters { reply } => {
                    let result = hosted
                        .as_ref()
                        .ok_or_else(|| "no plugin loaded".to_string())
                        .and_then(|plugin| plugin_parameters(plugin.instance.raw_instance()));
                    let _ = reply.send(result);
                }
                Request::SetParameter { id, value, reply } => {
                    let result = hosted
                        .as_mut()
                        .ok_or_else(|| "no plugin loaded".to_string())
                        .and_then(|plugin| queue_parameter(plugin, id, value));
                    let _ = reply.send(result);
                }
                Request::OpenGui { parent_x11, reply } => {
                    let result = hosted
                        .as_mut()
                        .ok_or_else(|| "no plugin loaded".to_string())
                        .and_then(|plugin| open_gui(plugin, parent_x11));
                    let _ = reply.send(result);
                }
                Request::CloseGui { reply } => {
                    let result = hosted
                        .as_mut()
                        .ok_or_else(|| "no plugin loaded".to_string())
                        .and_then(close_gui);
                    let _ = reply.send(result);
                }
                Request::Quit => break,
            }
        }
        if let Some(plugin) = hosted.as_mut() {
            destroy_gui(plugin);
        }
    }

    fn configured_load(
        rest: &str,
        restore_state: bool,
        input: &mut impl Read,
        scanned: &mut HashMap<String, PathBuf>,
        sender: &Sender<Request>,
    ) -> Result<u32, String> {
        let mut fields = rest.split('\t');
        let id = fields.next().unwrap_or_default().trim();
        let sample_rate = fields
            .next()
            .and_then(|value| value.parse::<f64>().ok())
            .ok_or_else(|| "LOAD_CONFIG requires a valid sample rate".to_string())?;
        let max_frames = fields
            .next()
            .and_then(|value| value.parse::<usize>().ok())
            .ok_or_else(|| "LOAD_CONFIG requires a valid block size".to_string())?;
        let state_length = if restore_state {
            Some(
                fields
                    .next()
                    .and_then(|value| value.parse::<usize>().ok())
                    .ok_or_else(|| "LOAD_CONFIG_STATE requires a valid state length".to_string())?,
            )
        } else {
            None
        };
        if fields.next().is_some() {
            return Err("unexpected fields in LOAD_CONFIG command".to_string());
        }
        if id.is_empty() || id.contains(['\r', '\n']) {
            return Err("invalid plugin id".to_string());
        }

        let state = match state_length {
            Some(length) if length > MAX_STATE_BYTES => {
                return Err(format!(
                    "plugin state exceeds the {MAX_STATE_BYTES}-byte limit"
                ));
            }
            Some(length) => {
                let mut state = vec![0; length];
                input
                    .read_exact(&mut state)
                    .map_err(|error| format!("plugin state bytes: {error}"))?;
                Some(state)
            }
            None => None,
        };

        if !scanned.contains_key(id) {
            let plugins = scan();
            scanned.clear();
            for plugin in plugins {
                scanned.entry(plugin.id).or_insert(plugin.path);
            }
        }
        let path = scanned
            .get(id)
            .cloned()
            .ok_or_else(|| format!("plugin {id} was not found; run SCAN first"))?;
        let (reply, response) = mpsc::channel();
        sender
            .send(Request::Load {
                path,
                id: id.to_string(),
                sample_rate,
                max_frames,
                state,
                reply,
            })
            .map_err(|_| "audio thread is gone".to_string())?;
        response
            .recv()
            .map_err(|_| "audio thread stopped".to_string())?
    }

    fn write_error(message: &str) {
        println!("ERROR {message}");
        let _ = io::stdout().flush();
    }

    fn save_plugin_state(sender: &Sender<Request>) -> Result<Option<Vec<u8>>, String> {
        let (reply, response) = mpsc::channel();
        sender
            .send(Request::SaveState { reply })
            .map_err(|_| "audio thread is gone".to_string())?;
        response
            .recv()
            .map_err(|_| "audio thread stopped".to_string())?
    }

    fn plugin_parameters_request(sender: &Sender<Request>) -> Result<Vec<ClapParameter>, String> {
        let (reply, response) = mpsc::channel();
        sender
            .send(Request::GetParameters { reply })
            .map_err(|_| "audio thread is gone".to_string())?;
        response
            .recv()
            .map_err(|_| "audio thread stopped".to_string())?
    }

    fn set_plugin_parameter(sender: &Sender<Request>, id: u32, value: f64) -> Result<(), String> {
        let (reply, response) = mpsc::channel();
        sender
            .send(Request::SetParameter { id, value, reply })
            .map_err(|_| "audio thread is gone".to_string())?;
        response
            .recv()
            .map_err(|_| "audio thread stopped".to_string())?
    }

    fn set_plugin_gui(
        sender: &Sender<Request>,
        open: bool,
        parent_x11: Option<u64>,
    ) -> Result<(), String> {
        let (reply, response) = mpsc::channel();
        let request = if open {
            Request::OpenGui { parent_x11, reply }
        } else {
            Request::CloseGui { reply }
        };
        sender
            .send(request)
            .map_err(|_| "audio thread is gone".to_string())?;
        response
            .recv()
            .map_err(|_| "audio thread stopped".to_string())?
    }

    fn write_state_response(state: Option<&[u8]>) -> Result<(), String> {
        let mut output = io::stdout().lock();
        match state {
            Some(state) => writeln!(output, "STATE {}", state.len())
                .and_then(|_| output.write_all(state))
                .and_then(|_| output.flush()),
            None => writeln!(output, "UNSUPPORTED").and_then(|_| output.flush()),
        }
        .map_err(|error| format!("could not write plugin state: {error}"))
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
            } else if let Some(rest) = command.strip_prefix("LOAD_CONFIG_STATE ") {
                match configured_load(rest, true, &mut input, &mut scanned, &sender) {
                    Ok(latency) => {
                        println!("READY {latency}");
                        let _ = io::stdout().flush();
                    }
                    Err(error) => write_error(&error),
                }
            } else if let Some(rest) = command.strip_prefix("LOAD_CONFIG ") {
                match configured_load(rest, false, &mut input, &mut scanned, &sender) {
                    Ok(latency) => {
                        println!("READY {latency}");
                        let _ = io::stdout().flush();
                    }
                    Err(error) => write_error(&error),
                }
            } else if let Some(rest) = command.strip_prefix("LOAD ") {
                // LOAD <id> is the public protocol. LOAD <path>\t<id> is kept
                // for direct probes and tests.
                let (path, id) = match rest.split_once('\t') {
                    Some((path, id)) => (PathBuf::from(path), id.to_string()),
                    None => {
                        let id = rest.trim();
                        if !scanned.contains_key(id) {
                            let plugins = scan();
                            scanned.clear();
                            for plugin in plugins {
                                scanned.entry(plugin.id).or_insert(plugin.path);
                            }
                        }
                        let Some(path) = scanned.get(id).cloned() else {
                            write_error(&format!("plugin {id} was not found; run SCAN first"));
                            continue;
                        };
                        (path, id.to_string())
                    }
                };
                let (reply, response) = mpsc::channel();
                if sender
                    .send(Request::Load {
                        path,
                        id,
                        sample_rate: 48_000.0,
                        max_frames: MAX_FRAMES,
                        state: None,
                        reply,
                    })
                    .is_err()
                {
                    write_error("audio thread is gone");
                    break;
                }
                match response.recv() {
                    Ok(Ok(_)) => {
                        println!("READY");
                        let _ = io::stdout().flush();
                    }
                    Ok(Err(error)) => write_error(&error),
                    Err(_) => {
                        write_error("audio thread stopped");
                        break;
                    }
                }
            } else if command == "SAVE_STATE" {
                match save_plugin_state(&sender)
                    .and_then(|state| write_state_response(state.as_deref()))
                {
                    Ok(()) => {}
                    Err(error) => write_error(&error),
                }
            } else if command == "PARAMS" {
                match plugin_parameters_request(&sender).and_then(|parameters| {
                    serde_json::to_string(&parameters)
                        .map_err(|error| format!("could not encode plugin parameters: {error}"))
                }) {
                    Ok(parameters) => {
                        println!("PARAMS {parameters}");
                        let _ = io::stdout().flush();
                    }
                    Err(error) => write_error(&error),
                }
            } else if let Some(rest) = command.strip_prefix("PARAM ") {
                let mut fields = rest.split('\t');
                let id = fields.next().and_then(|value| value.parse::<u32>().ok());
                let value = fields.next().and_then(|value| value.parse::<f64>().ok());
                if fields.next().is_some() || id.is_none() || value.is_none() {
                    write_error("PARAM requires an id and finite value");
                    continue;
                }
                let id = id.unwrap();
                let value = value.unwrap();
                match set_plugin_parameter(&sender, id, value) {
                    Ok(()) => {
                        println!("PARAM_SET");
                        let _ = io::stdout().flush();
                    }
                    Err(error) => write_error(&error),
                }
            } else if command == "GUI_OPEN" || command.starts_with("GUI_OPEN ") {
                let parent_x11 = command
                    .strip_prefix("GUI_OPEN ")
                    .filter(|value| !value.is_empty())
                    .and_then(|value| value.parse::<u64>().ok());
                if command.starts_with("GUI_OPEN ") && parent_x11.is_none() {
                    write_error("GUI_OPEN requires a valid optional X11 parent window id");
                    continue;
                }
                match set_plugin_gui(&sender, true, parent_x11) {
                    Ok(()) => {
                        println!("GUI_OPEN");
                        let _ = io::stdout().flush();
                    }
                    Err(error) => write_error(&error),
                }
            } else if command == "GUI_CLOSE" {
                match set_plugin_gui(&sender, false, None) {
                    Ok(()) => {
                        println!("GUI_CLOSED");
                        let _ = io::stdout().flush();
                    }
                    Err(error) => write_error(&error),
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
