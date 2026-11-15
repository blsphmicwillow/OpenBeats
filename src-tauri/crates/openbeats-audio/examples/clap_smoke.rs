#[cfg(target_os = "linux")]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    use std::path::PathBuf;
    use std::thread;
    use std::time::{Duration, Instant};

    use openbeats_audio::engine::NativeEngine;
    use openbeats_audio::plugin::PluginProcessor;
    use openbeats_audio::sequencer::PlaybackProject;

    fn measure_peak(engine: &NativeEngine, seconds: f32) -> (f32, u32) {
        let before = engine.snapshot().callbacks;
        let deadline = Instant::now() + Duration::from_secs_f32(seconds);
        let mut peak = 0.0f32;
        while Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
            let snapshot = engine.snapshot();
            peak = peak.max(snapshot.peak);
        }
        (peak, engine.snapshot().callbacks.wrapping_sub(before))
    }

    let args: Vec<String> = std::env::args().skip(1).collect();
    let device = args
        .windows(2)
        .find(|pair| pair[0] == "--device")
        .map(|pair| pair[1].clone())
        .ok_or("usage: clap_smoke --device <cpal-device> [--seconds <duration>]")?;
    let seconds = args
        .windows(2)
        .find(|pair| pair[0] == "--seconds")
        .and_then(|pair| pair[1].parse::<f32>().ok())
        .unwrap_or(1.5)
        .clamp(0.5, 10.0);
    let helper = std::env::var_os("OPENBEATS_CLAP_HELPER")
        .map(PathBuf::from)
        .ok_or("OPENBEATS_CLAP_HELPER must point to the built CLAP sidecar")?;
    let plugin_id = "studio.openbeats.gain";
    let gain_id = PluginProcessor::probe(&helper, plugin_id)?
        .into_iter()
        .find(|parameter| parameter.name == "Gain")
        .ok_or("OpenBeats Gain did not expose its Gain parameter")?
        .id;

    let project_json = serde_json::json!({
        "bpm": 120.0,
        "steps": 128,
        "master_gain": 1.0,
        "channels": [{
            "id": "clap-smoke",
            "preset": "keys",
            "mixer": 1,
            "gain": 1.0,
            "root": 60,
            "attack": 0.01,
            "release": 0.2
        }],
        "notes": [{
            "channel": "clap-smoke",
            "pitch": 60,
            "start": 0.0,
            "len": 128.0,
            "vel": 1.0
        }],
        "mixer": {
            "strips": [
                {"id": 0, "gain": 1.0},
                {
                    "id": 1,
                    "gain": 1.0,
                    "clap_plugin": {
                        "id": plugin_id,
                        "name": "OpenBeats Gain",
                        "vendor": "OpenBeats",
                        "parameters": {}
                    }
                },
            ]
        }
    });
    let mut project = PlaybackProject::from_json(&project_json.to_string())?;
    project.plugin_helper = Some(helper.clone());

    let engine = NativeEngine::start_with(Some(device.clone()), false)?;
    let mut dry_project = project.clone();
    dry_project.mixer.strips[1].clap_plugin = None;
    engine.play(dry_project)?;
    let (dry_peak, dry_callbacks) = measure_peak(&engine, seconds);
    if dry_callbacks == 0 || dry_peak < 0.001 {
        return Err(format!("dry mixer path was silent (peak {dry_peak})").into());
    }

    engine.play(project.clone())?;
    if !engine.set_plugin_parameter(1, plugin_id, gain_id, 0.25)? {
        return Err("the CLAP insert was not available to the mixer".into());
    }
    let (insert_peak, insert_callbacks) = measure_peak(&engine, seconds);
    if insert_callbacks == 0 || insert_peak < 0.001 || insert_peak >= dry_peak * 0.5 {
        return Err(format!(
            "live CLAP insert did not attenuate the mixer signal (dry {dry_peak}, insert {insert_peak})"
        )
        .into());
    }

    let captured = engine
        .capture_plugin_states()?
        .into_iter()
        .find(|(strip, id, _, _)| *strip == 1 && id == plugin_id)
        .ok_or("the mixer did not capture the inserted plugin")?;
    if (captured.3.get(&gain_id).copied().unwrap_or_default() - 0.25).abs() > 0.0001 {
        return Err("the saved project did not capture the live Gain value".into());
    }
    if captured.2.as_ref().map_or(true, |state| state.is_empty()) {
        return Err("OpenBeats Gain did not return a restorable plugin state".into());
    }
    let mut saved_project = project.clone();
    let insert = saved_project.mixer.strips[1]
        .clap_plugin
        .as_mut()
        .ok_or("the smoke project lost its plugin insert")?;
    insert.state = captured.2;
    insert.parameters = captured.3;

    let saved_json = serde_json::to_string(&saved_project)?;
    let mut reopened_project = PlaybackProject::from_json(&saved_json)?;
    reopened_project.plugin_helper = Some(helper);
    engine.play(reopened_project)?;
    let (reopened_peak, reopened_callbacks) = measure_peak(&engine, seconds);
    engine.stop();
    if reopened_callbacks == 0 || reopened_peak < 0.001 || reopened_peak >= dry_peak * 0.5 {
        return Err(format!(
            "reopened project did not restore the CLAP processing state (dry {dry_peak}, reopened {reopened_peak})"
        )
        .into());
    }

    println!(
        "{{\"device\":\"{}\",\"dry_peak\":{dry_peak:.6},\"insert_peak\":{insert_peak:.6},\"reopened_peak\":{reopened_peak:.6},\"state_bytes\":{},\"gain_parameter\":{}}}",
        device.replace('"', "'"),
        saved_project.mixer.strips[1]
            .clap_plugin
            .as_ref()
            .and_then(|plugin| plugin.state.as_ref())
            .map_or(0, Vec::len),
        gain_id
    );
    Ok(())
}

#[cfg(not(target_os = "linux"))]
fn main() {
    eprintln!("clap_smoke is a Linux-only CPAL/CLAP integration probe");
    std::process::exit(2);
}
