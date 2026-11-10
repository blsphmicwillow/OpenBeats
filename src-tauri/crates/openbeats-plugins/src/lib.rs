//! Native VST3/CLAP hosting for OpenBeats.
//!
//! Plugin code never runs in the application process. `plughost` starts the
//! `plughost-helper` binary — one short-lived process per bundle scan, one
//! long-lived process per chain — so a plugin that crashes or hangs takes only
//! its helper down.
//!
//! Platform support (verified against plughost 0.2.1):
//! - Windows: VST3 and CLAP
//! - macOS: VST3, CLAP and Audio Units
//! - Linux: **not supported by plughost 0.2.1** — powering this crate there
//!   compiles a stub whose calls return a clear error. The plugin browser keeps
//!   working; inserting a plugin is refused with an explanation.

#[cfg(not(target_os = "linux"))]
mod host;
#[cfg(not(target_os = "linux"))]
pub use host::*;

#[cfg(target_os = "linux")]
mod unsupported;
#[cfg(target_os = "linux")]
pub use unsupported::*;
