//! Offline encoding for the export dialog.
//!
//! WAV is written here byte for byte so a bounce never depends on a system
//! library, and FLAC uses the pure-Rust `flacenc` encoder. The lossy formats
//! (MP3/OGG/M4A) need an external `ffmpeg`, which the command layer shells out
//! to; the encoder in this module reports that instead of pretending to work.

/// One export target offered by the dialog.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportFormat {
    Wav16,
    Wav24,
    Flac,
    Mp3,
    Ogg,
    M4a,
}

impl ExportFormat {
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_lowercase().as_str() {
            "wav" | "wav16" | "wav-16" => Some(Self::Wav16),
            "wav24" | "wav-24" => Some(Self::Wav24),
            "flac" => Some(Self::Flac),
            "mp3" => Some(Self::Mp3),
            "ogg" | "vorbis" | "oga" => Some(Self::Ogg),
            "m4a" | "aac" | "mp4" => Some(Self::M4a),
            _ => None,
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            Self::Wav16 | Self::Wav24 => "wav",
            Self::Flac => "flac",
            Self::Mp3 => "mp3",
            Self::Ogg => "ogg",
            Self::M4a => "m4a",
        }
    }

    /// True when the bytes come from `ffmpeg` rather than this module.
    pub fn needs_ffmpeg(self) -> bool {
        matches!(self, Self::Mp3 | Self::Ogg | Self::M4a)
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Wav16 => "WAV 16-bit",
            Self::Wav24 => "WAV 24-bit",
            Self::Flac => "FLAC",
            Self::Mp3 => "MP3",
            Self::Ogg => "OGG Vorbis",
            Self::M4a => "M4A (AAC)",
        }
    }

    /// Encoder bit depth for the uncompressed/lossless formats.
    pub fn bits(self) -> u16 {
        match self {
            Self::Wav24 => 24,
            _ => 16,
        }
    }
}

/// ffmpeg codec arguments for the lossy targets.
pub fn ffmpeg_args(format: ExportFormat, quality: u8) -> Vec<String> {
    let q = quality.clamp(1, 10);
    match format {
        ExportFormat::Mp3 => {
            let kbps = match quality {
                0..=2 => "128k",
                3..=5 => "192k",
                _ => "320k",
            };
            vec![
                "-c:a".into(),
                "libmp3lame".into(),
                "-b:a".into(),
                kbps.into(),
            ]
        }
        ExportFormat::Ogg => {
            let quality = 0.1 + (q as f32 / 10.0) * 0.8;
            vec![
                "-c:a".into(),
                "libvorbis".into(),
                "-q:a".into(),
                format!("{quality:.2}"),
            ]
        }
        ExportFormat::M4a => {
            let kbps = if quality >= 7 { "256k" } else { "192k" };
            vec!["-c:a".into(), "aac".into(), "-b:a".into(), kbps.into()]
        }
        _ => Vec::new(),
    }
}

/// Interleaved f32 samples to a PCM WAV file (format 1, little endian).
pub fn wav_bytes(samples: &[f32], sample_rate: u32, channels: u16, bits: u16) -> Vec<u8> {
    let channels = channels.max(1);
    let bits: u16 = if bits <= 16 { 16 } else { 24 };
    let bytes_per_sample = (bits / 8) as usize;
    let data_len = samples.len() * bytes_per_sample;
    let mut out = Vec::with_capacity(44 + data_len);

    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&((36 + data_len) as u32).to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    let block_align = channels as u32 * bytes_per_sample as u32;
    out.extend_from_slice(&(sample_rate * block_align).to_le_bytes());
    out.extend_from_slice(&(block_align as u16).to_le_bytes());
    out.extend_from_slice(&bits.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(data_len as u32).to_le_bytes());

    for sample in samples {
        let clamped = sample.clamp(-1.0, 1.0);
        if bits == 16 {
            let value = (clamped * i16::MAX as f32).round() as i32;
            out.extend_from_slice(&(value as i16).to_le_bytes());
        } else {
            let value = (clamped * 8_388_607.0).round() as i32;
            let bytes = value.to_le_bytes();
            out.extend_from_slice(&bytes[0..3]);
        }
    }
    out
}

/// FLAC bytes for interleaved f32 samples.
fn flac_bytes(samples: &[f32], sample_rate: u32, channels: u16) -> Result<Vec<u8>, String> {
    use flacenc::component::BitRepr;
    use flacenc::error::Verify;
    use flacenc::source::MemSource;

    let channels = channels.max(1) as usize;
    let ints: Vec<i32> = samples
        .iter()
        .map(|s| (s.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i32)
        .collect();
    let source = MemSource::from_samples(&ints, channels, 16, sample_rate as usize);
    let config = flacenc::config::Encoder::default()
        .into_verified()
        .map_err(|e| format!("flac config rejected: {e:?}"))?;
    let stream = flacenc::encode_with_fixed_block_size(&config, source, 4096)
        .map_err(|e| format!("flac encode failed: {e:?}"))?;
    let mut sink = flacenc::bitsink::ByteSink::new();
    stream
        .write(&mut sink)
        .map_err(|e| format!("flac write failed: {e:?}"))?;
    Ok(sink.as_slice().to_vec())
}

/// Encodes the buffer, or explains which tool the format needs.
pub fn encode(
    format: ExportFormat,
    samples: &[f32],
    sample_rate: u32,
    channels: u16,
    _quality: u8,
) -> Result<Vec<u8>, String> {
    if samples.is_empty() {
        return Err("there is nothing to export yet".into());
    }
    match format {
        ExportFormat::Wav16 | ExportFormat::Wav24 => {
            Ok(wav_bytes(samples, sample_rate, channels, format.bits()))
        }
        ExportFormat::Flac => flac_bytes(samples, sample_rate, channels),
        other => Err(format!(
            "{} is encoded through ffmpeg; install ffmpeg or export WAV/FLAC",
            other.label()
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(frames: usize) -> Vec<f32> {
        (0..frames).map(|i| (i as f32 * 0.05).sin() * 0.5).collect()
    }

    #[test]
    fn wav_header_describes_the_buffer() {
        let bytes = wav_bytes(&tone(480), 48_000, 2, 16);
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        assert_eq!(&bytes[36..40], b"data");
        // 480 interleaved samples at 2 bytes each.
        assert_eq!(bytes.len(), 44 + 480 * 2);
        let data_len = u32::from_le_bytes(bytes[40..44].try_into().unwrap());
        assert_eq!(data_len, 480 * 2);
        let channels = u16::from_le_bytes(bytes[22..24].try_into().unwrap());
        assert_eq!(channels, 2);
        let rate = u32::from_le_bytes(bytes[24..28].try_into().unwrap());
        assert_eq!(rate, 48_000);
    }

    #[test]
    fn twenty_four_bit_uses_three_bytes_per_sample() {
        let bytes = wav_bytes(&tone(10), 44_100, 1, 24);
        assert_eq!(bytes.len(), 44 + 30);
        assert_eq!(u16::from_le_bytes(bytes[34..36].try_into().unwrap()), 24);
    }

    #[test]
    fn samples_are_clamped_not_wrapped() {
        let bytes = wav_bytes(&[2.0, -2.0], 48_000, 1, 16);
        let first = i16::from_le_bytes(bytes[44..46].try_into().unwrap());
        let second = i16::from_le_bytes(bytes[46..48].try_into().unwrap());
        assert_eq!(first, i16::MAX);
        assert_eq!(second, -i16::MAX);
    }

    #[test]
    fn flac_starts_with_its_magic() {
        let bytes = encode(ExportFormat::Flac, &tone(4_800), 48_000, 2, 5).unwrap();
        assert_eq!(&bytes[0..4], b"fLaC");
        assert!(bytes.len() > 64);
    }

    #[test]
    fn formats_parse_and_report_their_encoder() {
        assert_eq!(ExportFormat::parse("WAV"), Some(ExportFormat::Wav16));
        assert_eq!(ExportFormat::parse("mp3"), Some(ExportFormat::Mp3));
        assert_eq!(ExportFormat::parse("flac"), Some(ExportFormat::Flac));
        assert!(ExportFormat::Mp3.needs_ffmpeg());
        assert!(!ExportFormat::Flac.needs_ffmpeg());
        assert_eq!(ExportFormat::Wav24.bits(), 24);
        assert_eq!(ExportFormat::parse("aiff"), None);
    }

    #[test]
    fn mp3_asks_for_ffmpeg_instead_of_writing_a_fake_file() {
        let err = encode(ExportFormat::Mp3, &tone(64), 48_000, 2, 9).unwrap_err();
        assert!(err.contains("ffmpeg"));
    }
}
