//! OpenBeats plugin host helper.
//!
//! Plugins never load in the application process: `plughost` starts this binary
//! once per scan or chain, and a crash or hang only ends this helper.
//!
//! Linux: plughost 0.2.1 cannot build there, so this binary exists only so the
//! workspace builds; it exits with a clear message.

#[cfg(not(target_os = "linux"))]
fn main() -> std::process::ExitCode {
    plughost_helper::run()
}

#[cfg(target_os = "linux")]
fn main() {
    eprintln!(
        "plughost-helper: plugin hosting is unavailable on Linux (plughost 0.2.1 has no Linux platform layer)."
    );
    std::process::exit(78);
}
