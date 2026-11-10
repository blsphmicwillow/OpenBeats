//! Startup chime: decode the bundled WAV without pulling in a decoder crate.
//!
//! The asset is a 16-bit PCM WAV written by `scripts/make-chime.mjs`, so the
//! parser only has to handle the format it ships with and can stay tiny.

/// The bundled chime, embedded in the binary.
pub const CHIME_WAV: &[u8] = include_bytes!("../assets/chime.wav");

fn u32_at(bytes: &[u8], offset: usize) -> Option<u32> {
    bytes
        .get(offset..offset + 4)
        .map(|slice| u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

fn u16_at(bytes: &[u8], offset: usize) -> Option<u16> {
    bytes
        .get(offset..offset + 2)
        .map(|slice| u16::from_le_bytes([slice[0], slice[1]]))
}

/// Decodes the PCM16 WAV into mono samples plus its sample rate.
pub fn decode_wav(bytes: &[u8]) -> Result<(Vec<f32>, u32), String> {
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("not a RIFF/WAVE file".into());
    }
    let mut channels = 1u16;
    let mut sample_rate = 44_100u32;
    let mut bits = 16u16;
    let mut data: Option<&[u8]> = None;
    let mut offset = 12usize;
    while offset + 8 <= bytes.len() {
        let id = &bytes[offset..offset + 4];
        let size = u32_at(bytes, offset + 4).unwrap_or(0) as usize;
        let body_start = offset + 8;
        let body_end = body_start.saturating_add(size).min(bytes.len());
        match id {
            b"fmt " if size >= 16 => {
                channels = u16_at(bytes, body_start + 2).unwrap_or(1).max(1);
                sample_rate = u32_at(bytes, body_start + 4).unwrap_or(44_100);
                bits = u16_at(bytes, body_start + 14).unwrap_or(16);
            }
            b"data" => data = Some(&bytes[body_start..body_end]),
            _ => {}
        }
        // Chunks are word aligned.
        offset = body_start + size + (size & 1);
    }
    let data = data.ok_or("the file has no data chunk")?;
    if bits != 16 {
        return Err(format!(
            "only 16-bit PCM chimes are supported, this one is {bits}-bit"
        ));
    }
    let frames = data.len() / (2 * channels as usize);
    let mut mono = Vec::with_capacity(frames);
    for frame in 0..frames {
        let mut sum = 0.0f32;
        for channel in 0..channels as usize {
            let index = (frame * channels as usize + channel) * 2;
            let sample = i16::from_le_bytes([data[index], data[index + 1]]);
            sum += sample as f32 / 32_768.0;
        }
        mono.push(sum / channels as f32);
    }
    Ok((mono, sample_rate))
}

/// Decodes the bundled chime.
pub fn bundled() -> Result<(Vec<f32>, u32), String> {
    decode_wav(CHIME_WAV)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_bundled_asset_decodes_to_a_real_chime() {
        let (samples, rate) = bundled().unwrap();
        assert!(rate >= 44_100);
        assert!(samples.len() as f32 / rate as f32 > 0.5);
        let peak = samples.iter().fold(0.0f32, |m, s| m.max(s.abs()));
        assert!(peak > 0.05, "peak {peak}");
        assert!(samples.iter().all(|s| s.is_finite() && s.abs() <= 1.0));
    }

    #[test]
    fn broken_files_are_rejected() {
        assert!(decode_wav(b"not a wave").is_err());
        let mut truncated = CHIME_WAV.to_vec();
        truncated.truncate(20);
        assert!(decode_wav(&truncated).is_err());
    }
}
