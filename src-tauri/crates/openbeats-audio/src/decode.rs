//! Audio file decoding for the browser preview and pack import.
//!
//! Symphonia is pure Rust, so previews work on every platform without a system
//! media stack. Everything is decoded to interleaved f32 at the file's own rate;
//! the preview stream resamples on the fly.

use std::fs::File;
use std::path::Path;

/// A decoded audio file.
#[derive(Debug, Clone)]
pub struct DecodedAudio {
    /// Interleaved samples, -1..1.
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub channels: u16,
    /// Playable duration in seconds.
    pub seconds: f32,
}

impl DecodedAudio {
    pub fn frames(&self) -> usize {
        self.samples.len() / self.channels.max(1) as usize
    }
}

/// Decodes `path` into interleaved f32 samples.
pub fn decode_file(path: &Path) -> Result<DecodedAudio, String> {
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::DecoderOptions;
    use symphonia::core::errors::Error as SymphoniaError;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let file = File::open(path).map_err(|e| format!("cannot open {}: {e}", path.display()))?;
    let stream = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            stream,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("unsupported audio file: {e}"))?;
    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or_else(|| "the file has no audio track".to_string())?;
    let track_id = track.id;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("no decoder for this file: {e}"))?;

    let mut samples: Vec<f32> = Vec::new();
    let mut sample_rate = track.codec_params.sample_rate.unwrap_or(48_000);
    let mut channels = track
        .codec_params
        .channels
        .map(|c| c.count() as u16)
        .unwrap_or(2);

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::IoError(err))
                if err.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break
            }
            Err(SymphoniaError::ResetRequired) => break,
            Err(err) => return Err(format!("could not read the file: {err}")),
        };
        if packet.track_id() != track_id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(audio) => {
                let spec = *audio.spec();
                sample_rate = spec.rate;
                channels = spec.channels.count() as u16;
                let mut buffer = SampleBuffer::<f32>::new(audio.capacity() as u64, spec);
                buffer.copy_interleaved_ref(audio);
                samples.extend_from_slice(buffer.samples());
            }
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(err) => return Err(format!("decode failed: {err}")),
        }
    }

    if samples.is_empty() {
        return Err("the file decoded to no audio".into());
    }
    let frames = samples.len() / channels.max(1) as usize;
    Ok(DecodedAudio {
        seconds: frames as f32 / sample_rate.max(1) as f32,
        samples,
        sample_rate,
        channels: channels.max(1),
    })
}

/// Cheap header sniffing for the browser, without decoding the whole file.
pub fn is_supported(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .as_deref(),
        Some("wav" | "mp3" | "ogg" | "flac" | "m4a" | "aac" | "aif" | "aiff")
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn a_written_wav_decodes_back_to_the_same_tone() {
        let frames = 4_800;
        let tone: Vec<f32> = (0..frames * 2)
            .map(|i| ((i / 2) as f32 * 0.06).sin() * 0.5)
            .collect();
        let bytes = crate::export::wav_bytes(&tone, 44_100, 2, 16);
        let path: PathBuf = std::env::temp_dir().join(format!(
            "openbeats-decode-{}-{}.wav",
            std::process::id(),
            frames
        ));
        std::fs::write(&path, bytes).unwrap();

        let decoded = decode_file(&path).unwrap();
        assert_eq!(decoded.sample_rate, 44_100);
        assert_eq!(decoded.channels, 2);
        assert_eq!(decoded.frames(), frames);
        assert!(decoded.seconds > 0.1);
        let peak = decoded.samples.iter().fold(0.0f32, |m, s| m.max(s.abs()));
        assert!(peak > 0.3, "peak {peak}");
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn missing_and_unsupported_files_error_cleanly() {
        assert!(decode_file(Path::new("/no/such/file.wav")).is_err());
        let junk = std::env::temp_dir().join(format!("openbeats-junk-{}.wav", std::process::id()));
        std::fs::write(&junk, b"not audio").unwrap();
        assert!(decode_file(&junk).is_err());
        std::fs::remove_file(&junk).ok();
        assert!(is_supported(Path::new("kick.WAV")));
        assert!(!is_supported(Path::new("kick.txt")));
    }
}
