//! Sample-pack scanning and auto-tagging.
//!
//! Walks an imported folder and tags each audio file from its name and its parent
//! folders (a `Kick_808.wav` under `Drums/` becomes a Kick and a Drum), which is
//! what the Browser uses for its Packs tab.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const AUDIO_EXTENSIONS: [&str; 6] = ["wav", "mp3", "ogg", "flac", "aif", "aiff"];

const FAMILIES: [&str; 12] = [
    "kick", "snare", "hat", "clap", "perc", "tom", "bass", "808", "vocal", "loop", "fx", "chord",
];

pub fn is_audio(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| AUDIO_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Instrument/role tags inferred from the file name and its folder.
pub fn infer_tags(file_name: &str, folder: &str) -> Vec<String> {
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(file_name)
        .to_lowercase()
        .replace(['-', '_', '.'], " ");
    let folder = folder.to_lowercase();
    let mut tags = Vec::new();
    for family in FAMILIES {
        let in_name = stem.split_whitespace().any(|w| w.starts_with(family));
        let in_folder = folder.contains(family);
        if in_name || in_folder {
            let label = match family {
                "hat" => "Hi-hat",
                "fx" => "FX",
                "perc" => "Percussion",
                _ => family,
            };
            tags.push(label.to_string());
        }
    }
    if folder.contains("drum") && !tags.iter().any(|t| t == "Drums") {
        tags.push("Drums".into());
    }
    if folder.contains("bass") && !tags.iter().any(|t| t == "bass") {
        tags.push("bass".into());
    }
    tags
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PackSample {
    pub name: String,
    pub path: String,
    pub tags: Vec<String>,
    pub bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Pack {
    pub name: String,
    pub root: String,
    pub samples: Vec<PackSample>,
}

impl Pack {
    pub fn sample_count(&self) -> usize {
        self.samples.len()
    }
}

/// Recursively scans `root` for audio files.
pub fn scan(root: &Path) -> Result<Pack, String> {
    if !root.is_dir() {
        return Err(format!("{} is not a folder", root.display()));
    }
    let name = root
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Imported pack")
        .to_string();
    let mut samples = Vec::new();
    collect(root, root, &mut samples, 0)?;
    samples.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(Pack {
        name,
        root: root.display().to_string(),
        samples,
    })
}

fn collect(root: &Path, dir: &Path, out: &mut Vec<PackSample>, depth: usize) -> Result<(), String> {
    if depth > 8 {
        return Ok(());
    }
    let entries =
        std::fs::read_dir(dir).map_err(|e| format!("cannot read {}: {e}", dir.display()))?;
    for entry in entries.flatten() {
        let path: PathBuf = entry.path();
        if path.is_dir() {
            collect(root, &path, out, depth + 1)?;
            continue;
        }
        if !is_audio(&path) {
            continue;
        }
        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string();
        let folder = path
            .parent()
            .and_then(|p| p.strip_prefix(root).ok())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        out.push(PackSample {
            name: file_name.clone(),
            path: path.display().to_string(),
            tags: infer_tags(&file_name, &folder),
            bytes: entry.metadata().map(|m| m.len()).unwrap_or(0),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "openbeats-pack-{}-{}-{tag}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn names_and_folders_become_tags() {
        let tags = infer_tags("Kick_808.wav", "Drums");
        assert!(tags.contains(&"kick".to_string()));
        assert!(tags.contains(&"808".to_string()));
        assert!(tags.contains(&"Drums".to_string()));
        let hats = infer_tags("closed_hat_04.wav", "");
        assert!(hats.iter().any(|t| t == "Hi-hat"));
        assert!(infer_tags("notes.txt", "").is_empty());
    }

    #[test]
    fn scanning_finds_audio_and_ignores_everything_else() {
        let root = temp_dir("scan");
        let drums = root.join("Drums");
        fs::create_dir_all(&drums).unwrap();
        fs::write(root.join("Bass_loop.wav"), b"RIFF").unwrap();
        fs::write(drums.join("Snare_hard.WAV"), b"RIFF").unwrap();
        fs::write(root.join("readme.txt"), b"hello").unwrap();

        let pack = scan(&root).unwrap();
        assert_eq!(pack.sample_count(), 2);
        assert_eq!(pack.name, root.file_name().unwrap().to_string_lossy());
        let bass = pack
            .samples
            .iter()
            .find(|s| s.name.starts_with("Bass"))
            .unwrap();
        assert!(bass.tags.iter().any(|t| t == "bass"));
        let snare = pack
            .samples
            .iter()
            .find(|s| s.name.starts_with("Snare"))
            .unwrap();
        assert!(snare.tags.iter().any(|t| t == "snare"));
        assert!(snare.tags.iter().any(|t| t == "Drums"));

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_missing_folder_is_an_error() {
        assert!(scan(Path::new("/definitely/not/here/openbeats")).is_err());
    }

    #[test]
    fn extensions_are_checked_case_insensitively() {
        assert!(is_audio(Path::new("a.WAV")));
        assert!(is_audio(Path::new("a.flac")));
        assert!(!is_audio(Path::new("a.mp4")));
        assert!(!is_audio(Path::new("a")));
    }
}
