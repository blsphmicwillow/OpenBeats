use clap_sys::ext::gui::{
    clap_gui_resize_hints, clap_plugin_gui, clap_window, CLAP_EXT_GUI, CLAP_WINDOW_API_X11,
};
use clap_sys::factory::plugin_factory::{clap_plugin_factory, CLAP_PLUGIN_FACTORY_ID};
use clap_sys::host::clap_host;
use clap_sys::plugin::{clap_plugin, clap_plugin_descriptor};
use clap_sys::process::{clap_process, CLAP_PROCESS_CONTINUE};
use clap_sys::{entry::clap_plugin_entry, version::CLAP_VERSION};
use std::ffi::{c_char, c_int, c_uint, c_ulong, c_void, CStr};
use std::ptr;

#[repr(C)]
struct Display {
    _private: [u8; 0],
}

#[link(name = "X11")]
unsafe extern "C" {
    fn XOpenDisplay(name: *const c_char) -> *mut Display;
    fn XCloseDisplay(display: *mut Display) -> c_int;
    fn XDefaultScreen(display: *mut Display) -> c_int;
    fn XRootWindow(display: *mut Display, screen: c_int) -> c_ulong;
    fn XCreateSimpleWindow(
        display: *mut Display,
        parent: c_ulong,
        x: c_int,
        y: c_int,
        width: c_uint,
        height: c_uint,
        border_width: c_uint,
        border: c_ulong,
        background: c_ulong,
    ) -> c_ulong;
    fn XStoreName(display: *mut Display, window: c_ulong, name: *const c_char) -> c_int;
    fn XSetTransientForHint(display: *mut Display, window: c_ulong, parent: c_ulong) -> c_int;
    fn XMapWindow(display: *mut Display, window: c_ulong) -> c_int;
    fn XUnmapWindow(display: *mut Display, window: c_ulong) -> c_int;
    fn XDestroyWindow(display: *mut Display, window: c_ulong) -> c_int;
    fn XResizeWindow(
        display: *mut Display,
        window: c_ulong,
        width: c_uint,
        height: c_uint,
    ) -> c_int;
    fn XSync(display: *mut Display, discard: c_int) -> c_int;
}

struct PluginState {
    display: *mut Display,
    window: c_ulong,
}

static PLUGIN_ID: &[u8] = b"studio.openbeats.gui-fixture\0";
static PLUGIN_NAME: &[u8] = b"OpenBeats GUI Fixture\0";
static VENDOR: &[u8] = b"OpenBeats\0";
static URL: &[u8] = b"https://github.com/blsphmicwillow/OpenBeats\0";
static VERSION: &[u8] = b"0.1.0\0";
static DESCRIPTION: &[u8] = b"Native X11 GUI fixture for OpenBeats host tests\0";
static FEATURE: &[u8] = b"utility\0";
struct Features([*const c_char; 2]);
unsafe impl Sync for Features {}
static FEATURES: Features = Features([FEATURE.as_ptr().cast(), ptr::null()]);

static DESCRIPTOR: clap_plugin_descriptor = clap_plugin_descriptor {
    clap_version: CLAP_VERSION,
    id: PLUGIN_ID.as_ptr().cast(),
    name: PLUGIN_NAME.as_ptr().cast(),
    vendor: VENDOR.as_ptr().cast(),
    url: URL.as_ptr().cast(),
    manual_url: URL.as_ptr().cast(),
    support_url: URL.as_ptr().cast(),
    version: VERSION.as_ptr().cast(),
    description: DESCRIPTION.as_ptr().cast(),
    features: FEATURES.0.as_ptr(),
};

unsafe fn state<'a>(plugin: *const clap_plugin) -> &'a mut PluginState {
    unsafe { &mut *((*plugin).plugin_data as *mut PluginState) }
}

unsafe extern "C" fn plugin_init(_plugin: *const clap_plugin) -> bool {
    true
}

unsafe extern "C" fn plugin_destroy(plugin: *const clap_plugin) {
    if plugin.is_null() {
        return;
    }
    unsafe {
        let mut plugin = Box::from_raw(plugin as *mut clap_plugin);
        let mut state = Box::from_raw(plugin.plugin_data as *mut PluginState);
        close_window(&mut state);
        plugin.plugin_data = ptr::null_mut();
    }
}

unsafe extern "C" fn activate(
    _plugin: *const clap_plugin,
    sample_rate: f64,
    min_frames: u32,
    max_frames: u32,
) -> bool {
    sample_rate.is_finite() && sample_rate > 0.0 && min_frames > 0 && max_frames >= min_frames
}

unsafe extern "C" fn start_processing(_plugin: *const clap_plugin) -> bool {
    true
}

unsafe extern "C" fn process(_plugin: *const clap_plugin, _process: *const clap_process) -> i32 {
    CLAP_PROCESS_CONTINUE
}

unsafe extern "C" fn get_extension(
    _plugin: *const clap_plugin,
    id: *const c_char,
) -> *const c_void {
    if !id.is_null() && unsafe { CStr::from_ptr(id) } == CLAP_EXT_GUI {
        ptr::addr_of!(GUI).cast()
    } else {
        ptr::null()
    }
}

unsafe extern "C" fn is_api_supported(
    _plugin: *const clap_plugin,
    api: *const c_char,
    is_floating: bool,
) -> bool {
    is_floating && !api.is_null() && unsafe { CStr::from_ptr(api) } == CLAP_WINDOW_API_X11
}

unsafe extern "C" fn get_preferred_api(
    _plugin: *const clap_plugin,
    api: *mut *const c_char,
    is_floating: *mut bool,
) -> bool {
    if api.is_null() || is_floating.is_null() {
        return false;
    }
    unsafe {
        *api = CLAP_WINDOW_API_X11.as_ptr();
        *is_floating = true;
    }
    true
}

unsafe extern "C" fn create(
    plugin: *const clap_plugin,
    api: *const c_char,
    is_floating: bool,
) -> bool {
    if !unsafe { is_api_supported(plugin, api, is_floating) } {
        return false;
    }
    let display = unsafe { XOpenDisplay(ptr::null()) };
    if display.is_null() {
        return false;
    }
    let screen = unsafe { XDefaultScreen(display) };
    let root = unsafe { XRootWindow(display, screen) };
    let window = unsafe { XCreateSimpleWindow(display, root, 0, 0, 360, 160, 0, 0, 0) };
    if window == 0 {
        unsafe {
            XCloseDisplay(display);
        }
        return false;
    }
    let title = b"OpenBeats GUI Fixture\0";
    unsafe {
        XStoreName(display, window, title.as_ptr().cast());
        XSync(display, 0);
        let state = state(plugin);
        state.display = display;
        state.window = window;
    }
    true
}

unsafe extern "C" fn destroy(plugin: *const clap_plugin) {
    unsafe { close_window(state(plugin)) };
}

unsafe fn close_window(state: &mut PluginState) {
    if !state.display.is_null() {
        if state.window != 0 {
            unsafe {
                XDestroyWindow(state.display, state.window);
            }
        }
        unsafe {
            XSync(state.display, 0);
            XCloseDisplay(state.display);
        }
        state.display = ptr::null_mut();
        state.window = 0;
    }
}

unsafe extern "C" fn set_scale(_plugin: *const clap_plugin, scale: f64) -> bool {
    scale.is_finite() && scale > 0.0
}

unsafe extern "C" fn get_size(
    _plugin: *const clap_plugin,
    width: *mut u32,
    height: *mut u32,
) -> bool {
    if width.is_null() || height.is_null() {
        return false;
    }
    unsafe {
        *width = 360;
        *height = 160;
    }
    true
}

unsafe extern "C" fn can_resize(_plugin: *const clap_plugin) -> bool {
    true
}

unsafe extern "C" fn get_resize_hints(
    _plugin: *const clap_plugin,
    hints: *mut clap_gui_resize_hints,
) -> bool {
    if hints.is_null() {
        return false;
    }
    unsafe {
        *hints = clap_gui_resize_hints {
            can_resize_horizontally: true,
            can_resize_vertically: true,
            preserve_aspect_ratio: false,
            aspect_ratio_width: 0,
            aspect_ratio_height: 0,
        };
    }
    true
}

unsafe extern "C" fn adjust_size(
    _plugin: *const clap_plugin,
    width: *mut u32,
    height: *mut u32,
) -> bool {
    !width.is_null() && !height.is_null()
}

unsafe extern "C" fn set_size(plugin: *const clap_plugin, width: u32, height: u32) -> bool {
    let state = unsafe { state(plugin) };
    if state.display.is_null() || state.window == 0 || width == 0 || height == 0 {
        return false;
    }
    unsafe {
        XResizeWindow(state.display, state.window, width, height);
        XSync(state.display, 0);
    }
    true
}

unsafe extern "C" fn set_parent(plugin: *const clap_plugin, window: *const clap_window) -> bool {
    unsafe { set_transient(plugin, window) }
}

unsafe extern "C" fn set_transient(plugin: *const clap_plugin, window: *const clap_window) -> bool {
    if window.is_null() || unsafe { CStr::from_ptr((*window).api) } != CLAP_WINDOW_API_X11 {
        return false;
    }
    let state = unsafe { state(plugin) };
    if state.display.is_null() || state.window == 0 {
        return false;
    }
    unsafe {
        XSetTransientForHint(state.display, state.window, (*window).specific.x11);
        XSync(state.display, 0);
    }
    true
}

unsafe extern "C" fn show(plugin: *const clap_plugin) -> bool {
    let state = unsafe { state(plugin) };
    if state.display.is_null() || state.window == 0 {
        return false;
    }
    unsafe {
        XMapWindow(state.display, state.window);
        XSync(state.display, 0);
    }
    true
}

unsafe extern "C" fn hide(plugin: *const clap_plugin) -> bool {
    let state = unsafe { state(plugin) };
    if state.display.is_null() || state.window == 0 {
        return false;
    }
    unsafe {
        XUnmapWindow(state.display, state.window);
        XSync(state.display, 0);
    }
    true
}

static GUI: clap_plugin_gui = clap_plugin_gui {
    is_api_supported: Some(is_api_supported),
    get_preferred_api: Some(get_preferred_api),
    create: Some(create),
    destroy: Some(destroy),
    set_scale: Some(set_scale),
    get_size: Some(get_size),
    can_resize: Some(can_resize),
    get_resize_hints: Some(get_resize_hints),
    adjust_size: Some(adjust_size),
    set_size: Some(set_size),
    set_parent: Some(set_parent),
    set_transient: Some(set_transient),
    suggest_title: None,
    show: Some(show),
    hide: Some(hide),
};

unsafe extern "C" fn create_plugin(
    _factory: *const clap_plugin_factory,
    _host: *const clap_host,
    id: *const c_char,
) -> *const clap_plugin {
    if id.is_null()
        || unsafe { CStr::from_ptr(id) } != CStr::from_bytes_with_nul(PLUGIN_ID).unwrap()
    {
        return ptr::null();
    }
    let state = Box::new(PluginState {
        display: ptr::null_mut(),
        window: 0,
    });
    let plugin = Box::new(clap_plugin {
        desc: ptr::addr_of!(DESCRIPTOR),
        plugin_data: Box::into_raw(state).cast(),
        init: Some(plugin_init),
        destroy: Some(plugin_destroy),
        activate: Some(activate),
        deactivate: None,
        start_processing: Some(start_processing),
        stop_processing: None,
        reset: None,
        process: Some(process),
        get_extension: Some(get_extension),
        on_main_thread: None,
    });
    Box::into_raw(plugin)
}

unsafe extern "C" fn get_plugin_count(_factory: *const clap_plugin_factory) -> u32 {
    1
}

unsafe extern "C" fn get_plugin_descriptor(
    _factory: *const clap_plugin_factory,
    index: u32,
) -> *const clap_plugin_descriptor {
    if index == 0 {
        ptr::addr_of!(DESCRIPTOR)
    } else {
        ptr::null()
    }
}

static FACTORY: clap_plugin_factory = clap_plugin_factory {
    get_plugin_count: Some(get_plugin_count),
    get_plugin_descriptor: Some(get_plugin_descriptor),
    create_plugin: Some(create_plugin),
};

unsafe extern "C" fn init(_path: *const c_char) -> bool {
    true
}

unsafe extern "C" fn deinit() {}

unsafe extern "C" fn get_factory(id: *const c_char) -> *const c_void {
    if !id.is_null() && unsafe { CStr::from_ptr(id) } == CLAP_PLUGIN_FACTORY_ID {
        ptr::addr_of!(FACTORY).cast()
    } else {
        ptr::null()
    }
}

#[no_mangle]
pub static clap_entry: clap_plugin_entry = clap_plugin_entry {
    clap_version: CLAP_VERSION,
    init: Some(init),
    deinit: Some(deinit),
    get_factory: Some(get_factory),
};
