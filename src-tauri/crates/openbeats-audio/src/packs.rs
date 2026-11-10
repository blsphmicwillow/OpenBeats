//! Sample-pack scanning, safe archive extraction and import reports.
//!
//! The Browser's Packs tab uses this module. It recognises OpenBeats manifests,
//! FL-style category folders, generic one-shot zips and flat sample dumps. Audio
//! headers are checked before a file is listed, ZIP entries are validated before
//! anything is written, and FL preset/project files are read only as metadata.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use zip::ZipArchive;

const AUDIO_EXTENSIONS: [&str; 6] = ["wav", "mp3", "ogg", "flac", "aif", "aiff"];
const PRESET_EXTENSIONS: [&str; 3] = ["fxp", "fst", "flp"];

const FAMILIES: [&str; 12] = [
    "kick", "snare", "hat", "clap", "perc", "tom", "bass", "808", "vocal", "loop", "fx", "chord",
];

/// A pack archive may be at most 500 MB.
pub const MAX_ARCHIVE_BYTES: u64 = 500 * 1024 * 1024;
/// One sample may be at most 50 MB.
pub const MAX_SAMPLE_BYTES: u64 = 50 * 1024 * 1024;
/// Default total import budget, also used by the command when none is supplied.
pub const DEFAULT_TOTAL_BYTES: u64 = 2 * 1024 * 1024 * 1024;
/// A hard ceiling protects the app even if a caller asks for more.
pub const HARD_TOTAL_BYTES: u64 = 8 * 1024 * 1024 * 1024;
pub const MAX_ENTRIES: usize = 10_000;
const MAX_DEPTH: usize = 8;
const MAX_SCAN_FILES: usize = 20_000;
const MAX_PRESET_BYTES: u64 = 10 * 1024 * 1024;
const MAX_MANIFEST_BYTES: u64 = 2 * 1024 * 1024;
const MAX_LOG: usize = 1_000;
const MAX_SKIPPED_LIST: usize = 250;
const MAX_PRESETS: usize = 1_000;
const MAX_COMPRESSION_RATIO: u64 = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum PackFormat {
    OpenBeats,
    FlStudio,
    Generic,
    #[default]
    Flat,
}

impl PackFormat {
    pub fn label(self) -> &'static str {
        match self {
            Self::OpenBeats => "OpenBeats pack",
            Self::FlStudio => "FL-style pack",
            Self::Generic => "One-shot zip",
            Self::Flat => "Flat sample dump",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PackSample {
    pub name: String,
    pub path: String,
    pub tags: Vec<String>,
    pub bytes: u64,
    #[serde(default)]
    pub category: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PackPreset {
    pub name: String,
    pub plugin: String,
    pub source: String,
    /// `openbeats`, `vst2-fxp`, `fl-native-fst` or `flp-reference`.
    pub kind: String,
    pub playable: bool,
    pub notes: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PackSkip {
    pub file: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct PackReport {
    pub format: PackFormat,
    pub samples: usize,
    pub categories: BTreeMap<String, usize>,
    pub presets: usize,
    pub skipped: Vec<PackSkip>,
    pub skipped_count: usize,
    pub warnings: Vec<String>,
    pub log: Vec<String>,
    pub archive_bytes: u64,
    pub extracted_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Pack {
    pub name: String,
    pub root: String,
    pub samples: Vec<PackSample>,
    #[serde(default)]
    pub format: PackFormat,
    #[serde(default)]
    pub presets: Vec<PackPreset>,
    /// True when OpenBeats extracted this pack into its own data directory.
    #[serde(default)]
    pub managed: bool,
    #[serde(default)]
    pub warnings: Vec<String>,
}

impl Pack {
    pub fn sample_count(&self) -> usize {
        self.samples.len()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PackImport {
    pub pack: Pack,
    pub report: PackReport,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PackScan {
    pub pack: Pack,
    pub report: PackReport,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ExtractOutcome {
    pub extracted_bytes: u64,
    pub skipped: Vec<PackSkip>,
    pub skipped_count: usize,
}

pub fn is_audio(path: &Path) -> bool {
    extension(path).is_some_and(|ext| AUDIO_EXTENSIONS.contains(&ext.as_str()))
}

fn is_preset(path: &Path) -> bool {
    extension(path).is_some_and(|ext| PRESET_EXTENSIONS.contains(&ext.as_str()))
}

fn extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
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

/// Maps common FL drum/synth folder names to one canonical category.
pub fn category_for_name(name: &str) -> Option<&'static str> {
    let key: String = name
        .chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect();
    Some(match key.as_str() {
        "kick" | "kicks" => "kick",
        "snare" | "snares" => "snare",
        "clap" | "claps" => "clap",
        "hat" | "hats" | "hihat" | "hihats" | "openhat" | "openhats" => "hi-hat",
        "cymbal" | "cymbals" | "crash" | "crashes" | "ride" | "rides" => "cymbal",
        "perc" | "percs" | "percussion" => "perc",
        "tom" | "toms" => "tom",
        "rim" | "rims" => "rim",
        "fx" | "sfx" => "fx",
        "bass" | "basses" => "bass",
        "lead" | "leads" => "lead",
        "pad" | "pads" => "pad",
        "pluck" | "plucks" => "pluck",
        "key" | "keys" | "piano" | "pianos" => "keys",
        "vocal" | "vocals" | "vox" => "vocal",
        "loop" | "loops" => "loop",
        _ => return None,
    })
}

fn category_from_relative(path: &Path) -> Option<&'static str> {
    path.parent()
        .into_iter()
        .flat_map(|parent| parent.components())
        .filter_map(|component| match component {
            Component::Normal(name) => name.to_str(),
            _ => None,
        })
        .find_map(category_for_name)
}

fn category_from_tags(tags: &[String]) -> Option<&'static str> {
    tags.iter().find_map(|tag| category_for_name(tag))
}

fn has_category_dirs(root: &Path) -> bool {
    fn walk(dir: &Path, depth: usize) -> bool {
        if depth > 4 {
            return false;
        }
        let Ok(entries) = fs::read_dir(dir) else {
            return false;
        };
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_dir() || file_type.is_symlink() {
                continue;
            }
            if entry
                .file_name()
                .to_str()
                .and_then(category_for_name)
                .is_some()
            {
                return true;
            }
            if walk(&entry.path(), depth + 1) {
                return true;
            }
        }
        false
    }
    walk(root, 0)
}

fn root_has_audio(root: &Path) -> bool {
    fs::read_dir(root)
        .map(|entries| {
            entries.flatten().any(|entry| {
                entry.file_type().map(|t| t.is_file()).unwrap_or(false) && is_audio(&entry.path())
            })
        })
        .unwrap_or(false)
}

/// Chooses the most specific supported layout. `from_archive` distinguishes a
/// deliberate zip of loose one-shots from an otherwise unrecognised folder.
pub fn detect_format(root: &Path, from_archive: bool) -> PackFormat {
    let (manifest, _) = load_manifest(root);
    if manifest
        .as_ref()
        .is_some_and(|manifest| manifest.format.eq_ignore_ascii_case("openbeats-pack"))
    {
        return PackFormat::OpenBeats;
    }
    if has_category_dirs(root) {
        return PackFormat::FlStudio;
    }
    if from_archive {
        PackFormat::Generic
    } else {
        // A folder of loose one-shots is still a flat dump; the user can see the
        // warning instead of it being silently treated as a curated pack.
        let _ = root_has_audio(root);
        PackFormat::Flat
    }
}

#[derive(Default)]
struct ScanState {
    samples: Vec<PackSample>,
    presets: Vec<PackPreset>,
    skipped: Vec<PackSkip>,
    skipped_count: usize,
    warnings: Vec<String>,
    log: Vec<String>,
    seen_samples: HashSet<String>,
    seen_presets: HashSet<String>,
    files_seen: usize,
    depth_warned: bool,
    file_cap_warned: bool,
}

impl ScanState {
    fn log(&mut self, line: String) {
        if self.log.len() < MAX_LOG {
            self.log.push(line);
        } else if self.log.len() == MAX_LOG {
            self.log
                .push("… log truncated; the import continued".into());
        }
    }

    fn warn(&mut self, message: String) {
        if self.warnings.len() < 100 && !self.warnings.contains(&message) {
            self.warnings.push(message.clone());
        }
        self.log(message);
    }

    fn skip(&mut self, file: String, reason: String) {
        self.skipped_count += 1;
        if self.skipped.len() < MAX_SKIPPED_LIST {
            self.skipped.push(PackSkip {
                file: file.clone(),
                reason: reason.clone(),
            });
        }
        self.log(format!("skipped {file}: {reason}"));
    }
}

fn relative_display(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn safe_relative(path: &Path) -> bool {
    !path.as_os_str().is_empty()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

fn validate_audio_header(path: &Path) -> Result<(), String> {
    let ext = extension(path).unwrap_or_default();
    let mut file = File::open(path).map_err(|e| format!("could not open the sample: {e}"))?;
    let mut buffer = [0u8; 12];
    let read = file
        .read(&mut buffer)
        .map_err(|e| format!("could not read the sample header: {e}"))?;
    let bytes = &buffer[..read];
    let ok = match ext.as_str() {
        "wav" => {
            read >= 12
                && (bytes.starts_with(b"RIFF") || bytes.starts_with(b"RF64"))
                && &bytes[8..12] == b"WAVE"
        }
        "aif" | "aiff" => {
            read >= 12
                && bytes.starts_with(b"FORM")
                && (&bytes[8..12] == b"AIFF" || &bytes[8..12] == b"AIFC")
        }
        "flac" => bytes.starts_with(b"fLaC"),
        "ogg" => bytes.starts_with(b"OggS"),
        "mp3" => {
            bytes.starts_with(b"ID3")
                || (read >= 2 && bytes[0] == 0xFF && (bytes[1] & 0xE0) == 0xE0)
        }
        _ => true,
    };
    if ok {
        Ok(())
    } else {
        Err(format!(
            "the .{ext} file has a corrupt or unrecognised header"
        ))
    }
}

fn add_sample(
    root: &Path,
    path: &Path,
    state: &mut ScanState,
    category_override: Option<&str>,
    name_override: Option<&str>,
) {
    let key = path.to_string_lossy().to_string();
    if state.seen_samples.contains(&key) {
        return;
    }
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(err) => {
            state.skip(
                relative_display(root, path),
                format!("could not read it: {err}"),
            );
            return;
        }
    };
    if !metadata.is_file() {
        return;
    }
    if metadata.len() > MAX_SAMPLE_BYTES {
        state.skip(
            relative_display(root, path),
            format!(
                "larger than the {} MB sample limit",
                MAX_SAMPLE_BYTES / 1024 / 1024
            ),
        );
        return;
    }
    if let Err(reason) = validate_audio_header(path) {
        state.skip(relative_display(root, path), reason);
        return;
    }
    let relative = path.strip_prefix(root).unwrap_or(path);
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "sample".into());
    let folder = relative
        .parent()
        .map(|parent| parent.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();
    let tags = infer_tags(&file_name, &folder);
    let category = category_override
        .and_then(category_for_name)
        .or_else(|| category_from_relative(relative))
        .or_else(|| category_from_tags(&tags))
        .unwrap_or("unsorted")
        .to_string();
    state.seen_samples.insert(key);
    state.samples.push(PackSample {
        name: name_override
            .filter(|name| !name.trim().is_empty())
            .map(str::to_string)
            .unwrap_or(file_name),
        path: path.to_string_lossy().to_string(),
        tags,
        bytes: metadata.len(),
        category: category.clone(),
    });
    state.log(format!(
        "imported {} [{category}]",
        relative_display(root, path)
    ));
}

fn collect(root: &Path, dir: &Path, depth: usize, state: &mut ScanState) -> Result<(), String> {
    if depth > MAX_DEPTH {
        if !state.depth_warned {
            state.depth_warned = true;
            state.warn(format!(
                "Folder nesting deeper than {MAX_DEPTH} levels was ignored."
            ));
        }
        return Ok(());
    }
    let entries = fs::read_dir(dir).map_err(|e| format!("cannot read {}: {e}", dir.display()))?;
    for entry in entries.flatten() {
        if state.files_seen >= MAX_SCAN_FILES {
            if !state.file_cap_warned {
                state.file_cap_warned = true;
                state.warn(format!(
                    "Stopped after {MAX_SCAN_FILES} files; the rest of the pack was not scanned."
                ));
            }
            return Ok(());
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            state.log(format!(
                "skipped symlink {}",
                relative_display(root, &entry.path())
            ));
            continue;
        }
        let path = entry.path();
        if file_type.is_dir() {
            collect(root, &path, depth + 1, state)?;
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        state.files_seen += 1;
        if is_audio(&path) {
            add_sample(root, &path, state, None, None);
        } else if is_preset(&path) {
            add_preset(root, &path, state);
        }
    }
    Ok(())
}

pub fn scan(root: &Path) -> Result<Pack, String> {
    scan_pack(root, PackFormat::Flat, false).map(|scan| scan.pack)
}

/// Scans a validated pack folder and produces both the index entry and a report.
pub fn scan_pack(root: &Path, format: PackFormat, managed: bool) -> Result<PackScan, String> {
    if !root.is_dir() {
        return Err(format!("{} is not a folder", root.display()));
    }
    let (manifest, manifest_warning) = load_manifest(root);
    let mut state = ScanState::default();
    if let Some(warning) = manifest_warning {
        state.warn(warning);
    }
    let mut manifest_name = None;

    if let Some(manifest) = &manifest {
        if let Some(name) = manifest
            .name
            .as_ref()
            .filter(|name| !name.trim().is_empty())
        {
            manifest_name = Some(name.trim().to_string());
        }
        for entry in &manifest.samples {
            let (raw, name, category) = match entry {
                ManifestSampleEntry::Path(path) => (path.as_str(), None, None),
                ManifestSampleEntry::Detailed(sample) => (
                    sample.path.as_str(),
                    sample.name.as_deref(),
                    sample.category.as_deref(),
                ),
            };
            let normalised = raw.replace('\\', "/");
            let relative = Path::new(&normalised);
            if !safe_relative(&relative) {
                state.skip(raw.to_string(), "unsafe path in manifest.json".into());
                continue;
            }
            let path = root.join(&relative);
            if !path.is_file() {
                state.warn(format!("manifest.json lists a missing sample: {raw}"));
                continue;
            }
            if !is_audio(&path) {
                state.skip(
                    raw.to_string(),
                    "manifest sample is not an audio file".into(),
                );
                continue;
            }
            add_sample(root, &path, &mut state, category, name);
        }
        for preset in &manifest.presets {
            let (name, plugin, notes, params) = match preset {
                ManifestPresetEntry::Name(name) => (name.clone(), None, None, None),
                ManifestPresetEntry::Detailed(preset) => (
                    preset
                        .name
                        .clone()
                        .unwrap_or_else(|| "OpenBeats preset".into()),
                    preset.plugin.clone(),
                    preset.notes.clone(),
                    preset.params.clone(),
                ),
            };
            if state.presets.len() >= MAX_PRESETS {
                state.warn(format!(
                    "Only the first {MAX_PRESETS} presets were indexed."
                ));
                break;
            }
            state.presets.push(PackPreset {
                name: name.trim().to_string(),
                plugin: plugin.unwrap_or_else(|| "OpenBeats".into()),
                source: "manifest.json".into(),
                kind: "openbeats".into(),
                playable: params.is_some(),
                notes: notes
                    .unwrap_or_else(|| "OpenBeats preset from the pack manifest.".to_string()),
                params,
            });
        }
    }

    collect(root, root, 0, &mut state)?;

    let name = manifest_name
        .or_else(|| {
            root.file_name()
                .map(|name| name.to_string_lossy().to_string())
                .filter(|name| !name.trim().is_empty())
        })
        .unwrap_or_else(|| "Imported pack".into());

    if format == PackFormat::Flat {
        state.warn(
            "No manifest or FL-style category folders were found; imported as a flat sample dump."
                .into(),
        );
    } else if format == PackFormat::Generic {
        state.warn("No category folders were found; samples were tagged from their names.".into());
    } else if format == PackFormat::FlStudio {
        state.log("FL-style category folders detected.".into());
    }

    let mut categories = BTreeMap::new();
    for sample in &state.samples {
        *categories.entry(sample.category.clone()).or_insert(0) += 1;
    }
    let report = PackReport {
        format,
        samples: state.samples.len(),
        categories,
        presets: state.presets.len(),
        skipped_count: state.skipped_count,
        skipped: state.skipped,
        warnings: state.warnings.clone(),
        log: state.log,
        archive_bytes: 0,
        extracted_bytes: 0,
    };
    let pack = Pack {
        name,
        root: root.to_string_lossy().to_string(),
        samples: state.samples,
        format,
        presets: state.presets,
        managed,
        warnings: state.warnings,
    };
    Ok(PackScan { pack, report })
}

fn read_limited(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let metadata = fs::metadata(path).map_err(|e| format!("could not read it: {e}"))?;
    if metadata.len() > limit {
        return Err(format!(
            "the file is larger than {} MB",
            limit / 1024 / 1024
        ));
    }
    let mut file = File::open(path).map_err(|e| format!("could not open it: {e}"))?;
    let mut bytes = Vec::new();
    std::io::Read::by_ref(&mut file)
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("could not read it: {e}"))?;
    if bytes.len() as u64 > limit {
        return Err(format!(
            "the file is larger than {} MB",
            limit / 1024 / 1024
        ));
    }
    Ok(bytes)
}

fn add_preset(root: &Path, path: &Path, state: &mut ScanState) {
    if state.presets.len() >= MAX_PRESETS {
        if state.presets.len() == MAX_PRESETS {
            state.warn(format!(
                "Only the first {MAX_PRESETS} presets were indexed."
            ));
        }
        return;
    }
    let key = path.to_string_lossy().to_string();
    if state.seen_presets.contains(&key) {
        return;
    }
    let relative = relative_display(root, path);
    let bytes = match read_limited(path, MAX_PRESET_BYTES) {
        Ok(bytes) => bytes,
        Err(reason) => {
            state.skip(relative, reason);
            return;
        }
    };
    let name = path
        .file_stem()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "Preset".into());
    let plugin_hint = path
        .parent()
        .and_then(|parent| parent.file_name())
        .map(|name| name.to_string_lossy().to_string());
    let extension = extension(path).unwrap_or_default();
    let parsed = match extension.as_str() {
        "fxp" => parse_fxp(&bytes, &name, plugin_hint.as_deref()),
        "fst" => parse_fst(&bytes, &name, plugin_hint.as_deref()),
        "flp" => parse_flp(&bytes, &name),
        _ => return,
    };
    match parsed {
        Ok(mut preset) => {
            preset.source = relative.clone();
            state.seen_presets.insert(key);
            state.log(format!(
                "indexed preset {relative} ({})",
                if preset.playable {
                    "playable"
                } else {
                    "preview only"
                }
            ));
            state.presets.push(preset);
        }
        Err(reason) => state.skip(relative, reason),
    }
}

fn printable_strings(bytes: &[u8], limit: usize) -> Vec<String> {
    let mut strings = Vec::new();
    let mut current = String::new();
    for byte in bytes {
        if (32..=126).contains(byte) || *byte == b'\t' {
            if current.len() < 80 {
                current.push(*byte as char);
            }
        } else {
            let trimmed = current.trim().to_string();
            if trimmed.len() >= 4 && !strings.contains(&trimmed) {
                strings.push(trimmed);
                if strings.len() >= limit {
                    return strings;
                }
            }
            current.clear();
        }
    }
    let trimmed = current.trim().to_string();
    if trimmed.len() >= 4 && !strings.contains(&trimmed) && strings.len() < limit {
        strings.push(trimmed);
    }
    strings
}

fn fourcc(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return "unknown".into();
    }
    if bytes.iter().all(|byte| (32..=126).contains(byte)) {
        String::from_utf8_lossy(bytes).to_string()
    } else {
        bytes
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    }
}

fn c_string(bytes: &[u8]) -> String {
    let end = bytes
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(bytes.len());
    String::from_utf8_lossy(&bytes[..end]).trim().to_string()
}

/// Reads a VST2 `.fxp` without pretending to host the plugin. FXP files store
/// plugin/preset identity and parameter values, but not parameter names.
pub fn parse_fxp(
    bytes: &[u8],
    fallback_name: &str,
    plugin_hint: Option<&str>,
) -> Result<PackPreset, String> {
    if bytes.len() < 60 || &bytes[0..4] != b"CcnK" {
        return Err("not a VST2 FXP preset (missing CcnK header)".into());
    }
    let size = u32::from_be_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]) as usize;
    if size.saturating_add(8) > bytes.len() {
        return Err("the FXP chunk is truncated".into());
    }
    if &bytes[8..12] != b"FPCh" {
        return Err("the FXP header is not an FPCh chunk".into());
    }
    let plugin = fourcc(&bytes[16..20]);
    let stored_name = c_string(&bytes[28..56]);
    let name = if stored_name.is_empty() {
        fallback_name.to_string()
    } else {
        stored_name
    };
    let chunk = &bytes[56..];
    let kind = if chunk.starts_with(b"FxCk") {
        let count = chunk
            .get(4..8)
            .map(|value| u32::from_be_bytes([value[0], value[1], value[2], value[3]]))
            .unwrap_or(0);
        format!("{count} parameter values")
    } else if chunk.starts_with(b"FPCh") {
        "an opaque plugin chunk".to_string()
    } else {
        "an unknown VST2 chunk".to_string()
    };
    Ok(PackPreset {
        name,
        plugin: if plugin == "unknown" {
            plugin_hint.unwrap_or("Unknown VST2").to_string()
        } else {
            plugin
        },
        source: String::new(),
        kind: "vst2-fxp".into(),
        playable: false,
        notes: format!(
            "VST2 preset with {kind}. FXP does not store parameter names, and OpenBeats does not host VST2 plugins; this is metadata only."
        ),
        params: None,
    })
}

fn parse_fst(
    bytes: &[u8],
    fallback_name: &str,
    plugin_hint: Option<&str>,
) -> Result<PackPreset, String> {
    if bytes.len() < 4 {
        return Err("the FST preset is empty or truncated".into());
    }
    let strings = printable_strings(bytes, 10);
    let header = bytes
        .iter()
        .take(12)
        .map(|byte| format!("{byte:02x}"))
        .collect::<Vec<_>>()
        .join(" ");
    let detail = if strings.is_empty() {
        String::new()
    } else {
        format!(" Readable strings: {}.", strings.join(" · "))
    };
    Ok(PackPreset {
        name: fallback_name.to_string(),
        plugin: plugin_hint.unwrap_or("FL native").to_string(),
        source: String::new(),
        kind: "fl-native-fst".into(),
        playable: false,
        notes: format!(
            "FL native preset — preview only, not executable here. Header: {header}.{detail}"
        ),
        params: None,
    })
}

fn parse_flp(bytes: &[u8], fallback_name: &str) -> Result<PackPreset, String> {
    if bytes.len() < 8 || &bytes[0..4] != b"FLhd" {
        return Err("not an FL Studio project (missing FLhd header)".into());
    }
    if !bytes.windows(4).take(64).any(|window| window == b"FLdt") {
        return Err("the FLP project data chunk is missing".into());
    }
    let strings = printable_strings(bytes, 16);
    let names = if strings.is_empty() {
        "no readable channel or pattern names".to_string()
    } else {
        strings.join(" · ")
    };
    Ok(PackPreset {
        name: fallback_name.to_string(),
        plugin: "FL Studio".into(),
        source: String::new(),
        kind: "flp-reference".into(),
        playable: false,
        notes: format!(
            "Read-only pattern reference — this is not played or converted. Inferred names: {names}."
        ),
        params: None,
    })
}

/* ------------------------------------------------------------------ *
 * OpenBeats manifest
 * ------------------------------------------------------------------ */

#[derive(Debug, Deserialize)]
struct PackManifest {
    #[serde(default)]
    format: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    samples: Vec<ManifestSampleEntry>,
    #[serde(default)]
    presets: Vec<ManifestPresetEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum ManifestSampleEntry {
    Detailed(ManifestSample),
    Path(String),
}

#[derive(Debug, Deserialize)]
struct ManifestSample {
    path: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    category: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum ManifestPresetEntry {
    Detailed(ManifestPreset),
    Name(String),
}

#[derive(Debug, Deserialize)]
struct ManifestPreset {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    plugin: Option<String>,
    #[serde(default)]
    notes: Option<String>,
    #[serde(default)]
    params: Option<Value>,
}

fn load_manifest(root: &Path) -> (Option<PackManifest>, Option<String>) {
    let path = root.join("manifest.json");
    if !path.is_file() {
        return (None, None);
    }
    let bytes = match read_limited(&path, MAX_MANIFEST_BYTES) {
        Ok(bytes) => bytes,
        Err(reason) => return (None, Some(format!("manifest.json was ignored: {reason}"))),
    };
    match serde_json::from_slice::<PackManifest>(&bytes) {
        Ok(manifest) => (Some(manifest), None),
        Err(err) => (
            None,
            Some(format!("manifest.json is not valid JSON for a pack: {err}")),
        ),
    }
}

/* ------------------------------------------------------------------ *
 * ZIP extraction
 * ------------------------------------------------------------------ */

fn allowed_entry(path: &Path) -> bool {
    is_audio(path)
        || is_preset(path)
        || path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| {
                name.eq_ignore_ascii_case("manifest.json")
                    || matches!(
                        extension(path).as_deref(),
                        Some("txt" | "md" | "nfo" | "pdf" | "png" | "jpg" | "jpeg" | "webp")
                    )
            })
}

fn is_symlink_mode(mode: u32) -> bool {
    mode & 0o170_000 == 0o120_000
}

/// Validates every central-directory entry before writing anything, then
/// extracts into an empty staging directory. Path traversal, symlinks, archive
/// bombs, oversized samples and unsupported executables are rejected or skipped.
pub fn extract_zip_to(
    archive_path: &Path,
    target: &Path,
    max_total_bytes: u64,
) -> Result<ExtractOutcome, String> {
    let file =
        File::open(archive_path).map_err(|e| format!("could not open the zip archive: {e}"))?;
    let archive_size = file
        .metadata()
        .map_err(|e| format!("could not inspect the zip archive: {e}"))?
        .len();
    if archive_size > MAX_ARCHIVE_BYTES {
        return Err(format!(
            "that zip is larger than the {} MB archive limit",
            MAX_ARCHIVE_BYTES / 1024 / 1024
        ));
    }
    if archive_size == 0 {
        return Err("that zip is empty".into());
    }
    let mut archive =
        ZipArchive::new(file).map_err(|e| format!("not a readable zip archive: {e}"))?;
    if archive.len() == 0 {
        return Err("that zip contains no entries".into());
    }
    if archive.len() > MAX_ENTRIES {
        return Err(format!(
            "that zip has {} entries; the limit is {MAX_ENTRIES}",
            archive.len()
        ));
    }

    let max_total = max_total_bytes.clamp(1, HARD_TOTAL_BYTES);
    let mut total = 0u64;
    let mut compressed_total = 0u64;
    let mut skipped = Vec::new();
    let mut skipped_count = 0usize;
    let mut skip_indices = HashSet::new();
    let mut names = HashSet::new();

    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|e| format!("zip entry {index} is unreadable: {e}"))?;
        let raw_name = entry.name().to_string();
        if raw_name.contains('\\') {
            return Err(format!("zip entry uses a backslash path: {raw_name}"));
        }
        let relative = entry
            .enclosed_name()
            .ok_or_else(|| format!("zip entry escapes the pack folder: {raw_name}"))?;
        if !safe_relative(&relative) {
            return Err(format!("zip entry has an unsafe path: {raw_name}"));
        }
        if entry.is_symlink() || entry.unix_mode().is_some_and(is_symlink_mode) {
            return Err(format!("zip entry is a symbolic link: {raw_name}"));
        }
        if entry.is_dir() {
            continue;
        }
        if !names.insert(relative.clone()) {
            return Err(format!("zip contains the same path twice: {raw_name}"));
        }
        if !allowed_entry(&relative) {
            skipped_count += 1;
            if skipped.len() < MAX_SKIPPED_LIST {
                skipped.push(PackSkip {
                    file: raw_name,
                    reason: "unsupported file type".into(),
                });
            }
            skip_indices.insert(index);
            continue;
        }
        let size = entry.size();
        let compressed = entry.compressed_size();
        if size > MAX_SAMPLE_BYTES {
            skipped_count += 1;
            if skipped.len() < MAX_SKIPPED_LIST {
                skipped.push(PackSkip {
                    file: raw_name.clone(),
                    reason: format!(
                        "larger than the {} MB per-file limit",
                        MAX_SAMPLE_BYTES / 1024 / 1024
                    ),
                });
            }
            skip_indices.insert(index);
            continue;
        }
        if compressed == 0 && size > 1024 * 1024 {
            return Err(format!(
                "zip entry is an unsafe compression bomb: {raw_name}"
            ));
        }
        if compressed > 0 && size > 2 * 1024 * 1024 && size / compressed > MAX_COMPRESSION_RATIO {
            return Err(format!(
                "zip entry expands more than {MAX_COMPRESSION_RATIO}×: {raw_name}"
            ));
        }
        total = total.saturating_add(size);
        compressed_total = compressed_total.saturating_add(compressed);
        if total > max_total {
            return Err(format!(
                "that pack expands to more than the {} GB import limit",
                max_total / 1024 / 1024 / 1024
            ));
        }
    }
    if total > 64 * 1024 * 1024
        && compressed_total > 0
        && total / compressed_total > MAX_COMPRESSION_RATIO
    {
        return Err(format!(
            "that zip expands more than {MAX_COMPRESSION_RATIO}× overall"
        ));
    }

    fs::create_dir_all(target)
        .map_err(|e| format!("could not create the import staging folder: {e}"))?;
    let mut extracted_bytes = 0u64;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| format!("zip entry {index} became unreadable: {e}"))?;
        let relative = entry
            .enclosed_name()
            .ok_or_else(|| "zip entry escaped the pack folder".to_string())?;
        let destination = target.join(&relative);
        if entry.is_dir() {
            fs::create_dir_all(&destination)
                .map_err(|e| format!("could not create {}: {e}", destination.display()))?;
            continue;
        }
        if skip_indices.contains(&index) {
            continue;
        }
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
        }
        let expected = entry.size();
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
            .map_err(|e| format!("could not write {}: {e}", destination.display()))?;
        let copied = std::io::copy(
            &mut entry.by_ref().take(expected.saturating_add(1)),
            &mut output,
        )
        .map_err(|e| format!("could not extract {}: {e}", relative.display()))?;
        output
            .flush()
            .map_err(|e| format!("could not finish {}: {e}", relative.display()))?;
        if copied != expected {
            return Err(format!(
                "zip entry {} had an inconsistent size",
                relative.display()
            ));
        }
        extracted_bytes = extracted_bytes.saturating_add(copied);
        if extracted_bytes > max_total {
            return Err("the extracted pack exceeded the import limit".into());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&destination, fs::Permissions::from_mode(0o644));
        }
    }

    Ok(ExtractOutcome {
        extracted_bytes,
        skipped,
        skipped_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use zip::write::SimpleFileOptions;

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

    fn wav_header() -> &'static [u8] {
        b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00"
    }

    fn write_zip(path: &Path, entries: &[(&str, &[u8])]) -> Result<(), String> {
        let file = File::create(path).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipWriter::new(file);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (name, data) in entries {
            zip.start_file(*name, options).map_err(|e| e.to_string())?;
            zip.write_all(data).map_err(|e| e.to_string())?;
        }
        zip.finish().map_err(|e| e.to_string())?;
        Ok(())
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
        fs::write(root.join("Bass_loop.wav"), wav_header()).unwrap();
        fs::write(drums.join("Snare_hard.WAV"), wav_header()).unwrap();
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

    #[test]
    fn detects_native_fl_generic_and_flat_layouts() {
        let native = temp_dir("format-native");
        fs::write(
            native.join("manifest.json"),
            br#"{"format":"openbeats-pack","name":"Native"}"#,
        )
        .unwrap();
        assert_eq!(detect_format(&native, false), PackFormat::OpenBeats);

        let fl = temp_dir("format-fl");
        fs::create_dir_all(fl.join("Kicks")).unwrap();
        fs::write(fl.join("Kicks/Kick.wav"), wav_header()).unwrap();
        assert_eq!(detect_format(&fl, false), PackFormat::FlStudio);

        let generic = temp_dir("format-generic");
        fs::write(generic.join("one.wav"), wav_header()).unwrap();
        assert_eq!(detect_format(&generic, true), PackFormat::Generic);

        let flat = temp_dir("format-flat");
        fs::write(flat.join("one.wav"), wav_header()).unwrap();
        assert_eq!(detect_format(&flat, false), PackFormat::Flat);

        for dir in [native, fl, generic, flat] {
            fs::remove_dir_all(dir).ok();
        }
    }

    #[test]
    fn a_corrupt_wav_and_oversized_sample_are_reported_not_panicked() {
        let root = temp_dir("corrupt");
        fs::write(root.join("good.wav"), wav_header()).unwrap();
        fs::write(root.join("bad.wav"), b"not a wave file").unwrap();
        let large = root.join("huge.wav");
        fs::write(&large, wav_header()).unwrap();
        let file = fs::OpenOptions::new().write(true).open(&large).unwrap();
        file.set_len(MAX_SAMPLE_BYTES + 1).unwrap();
        drop(file);

        let scan = scan_pack(&root, PackFormat::Generic, false).unwrap();
        assert_eq!(scan.pack.samples.len(), 1);
        assert_eq!(scan.report.skipped_count, 2);
        assert!(scan
            .report
            .skipped
            .iter()
            .any(|skip| skip.file.contains("bad.wav")));
        assert!(scan
            .report
            .skipped
            .iter()
            .any(|skip| skip.file.contains("huge.wav")));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn fl_manifest_categories_are_used_in_the_report() {
        let root = temp_dir("categories");
        fs::create_dir_all(root.join("Kicks")).unwrap();
        fs::create_dir_all(root.join("Snares")).unwrap();
        fs::write(root.join("Kicks/k.wav"), wav_header()).unwrap();
        fs::write(root.join("Snares/s.wav"), wav_header()).unwrap();
        let scan = scan_pack(&root, PackFormat::FlStudio, false).unwrap();
        assert_eq!(scan.report.categories.get("kick"), Some(&1));
        assert_eq!(scan.report.categories.get("snare"), Some(&1));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn manifest_samples_and_presets_are_registered() {
        let root = temp_dir("manifest");
        fs::write(root.join("Kick.wav"), wav_header()).unwrap();
        fs::write(
            root.join("manifest.json"),
            br#"{
                "format":"openbeats-pack",
                "name":"Testing Pack",
                "samples":[{"path":"Kick.wav","name":"Manifest Kick","category":"Kicks"}],
                "presets":[{"name":"Warm Keys","plugin":"OpenBeats","params":{"preset":"keys"}}]
            }"#,
        )
        .unwrap();
        let scan = scan_pack(&root, PackFormat::OpenBeats, false).unwrap();
        assert_eq!(scan.pack.name, "Testing Pack");
        assert_eq!(scan.pack.samples[0].name, "Manifest Kick");
        assert_eq!(scan.pack.samples[0].category, "kick");
        assert_eq!(scan.pack.presets.len(), 1);
        assert!(scan.pack.presets[0].playable);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn fxp_metadata_is_parsed_without_panicking() {
        let mut bytes = vec![0u8; 76];
        bytes[0..4].copy_from_slice(b"CcnK");
        bytes[4..8].copy_from_slice(&(68u32).to_be_bytes());
        bytes[8..12].copy_from_slice(b"FPCh");
        bytes[16..20].copy_from_slice(b"Syn1");
        bytes[28..38].copy_from_slice(b"Warm Keys\0");
        bytes[56..60].copy_from_slice(b"FxCk");
        bytes[60..64].copy_from_slice(&12u32.to_be_bytes());
        let preset = parse_fxp(&bytes, "fallback", None).unwrap();
        assert_eq!(preset.name, "Warm Keys");
        assert_eq!(preset.plugin, "Syn1");
        assert!(preset.notes.contains("12 parameter values"));
        assert!(!preset.playable);
        assert!(parse_fxp(b"", "x", None).is_err());
        assert!(parse_fxp(b"CcnK\xff\xff\xff\xff", "x", None).is_err());
    }

    #[test]
    fn empty_and_truncated_zips_are_errors() {
        let root = temp_dir("zip-empty");
        let empty = root.join("empty.zip");
        fs::write(&empty, b"").unwrap();
        assert!(extract_zip_to(&empty, &root.join("out"), DEFAULT_TOTAL_BYTES).is_err());

        let valid = root.join("valid.zip");
        write_zip(&valid, &[("Kick.wav", wav_header())]).unwrap();
        let bytes = fs::read(&valid).unwrap();
        let truncated = root.join("truncated.zip");
        fs::write(&truncated, &bytes[..bytes.len() / 2]).unwrap();
        assert!(extract_zip_to(&truncated, &root.join("out2"), DEFAULT_TOTAL_BYTES).is_err());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn traversal_symlinks_and_compression_bombs_are_rejected() {
        let root = temp_dir("zip-guards");
        let traversal = root.join("traversal.zip");
        write_zip(&traversal, &[("../../etc/passwd", b"nope")]).unwrap();
        assert!(extract_zip_to(&traversal, &root.join("out"), DEFAULT_TOTAL_BYTES).is_err());
        assert!(!root.join("etc/passwd").exists());

        let symlink = root.join("symlink.zip");
        let file = File::create(&symlink).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        zip.add_symlink("link.wav", "/etc/passwd", SimpleFileOptions::default())
            .unwrap();
        zip.finish().unwrap();
        assert!(extract_zip_to(&symlink, &root.join("out2"), DEFAULT_TOTAL_BYTES).is_err());

        let bomb = root.join("bomb.zip");
        let zeros = vec![0u8; 4 * 1024 * 1024];
        write_zip(&bomb, &[("bomb.wav", &zeros)]).unwrap();
        assert!(extract_zip_to(&bomb, &root.join("out3"), DEFAULT_TOTAL_BYTES).is_err());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn too_many_zip_entries_are_rejected_cleanly() {
        let root = temp_dir("zip-count");
        let path = root.join("many.zip");
        let file = File::create(&path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        for index in 0..=MAX_ENTRIES {
            zip.start_file(format!("{index}.txt"), options).unwrap();
        }
        zip.finish().unwrap();
        let error = extract_zip_to(&path, &root.join("out"), DEFAULT_TOTAL_BYTES).unwrap_err();
        assert!(error.contains("entries"));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_safe_zip_extracts_into_staging() {
        let root = temp_dir("zip-safe");
        let path = root.join("safe.zip");
        write_zip(
            &path,
            &[
                ("Kicks/Kick.wav", wav_header()),
                ("readme.txt", b"hello"),
                ("evil.exe", b"MZ"),
            ],
        )
        .unwrap();
        let out = root.join("out");
        let result = extract_zip_to(&path, &out, DEFAULT_TOTAL_BYTES).unwrap();
        assert!(out.join("Kicks/Kick.wav").is_file());
        assert!(out.join("readme.txt").is_file());
        assert!(!out.join("evil.exe").exists());
        assert_eq!(result.skipped_count, 1);
        fs::remove_dir_all(&root).ok();
    }

    #[cfg(unix)]
    #[test]
    fn non_utf8_filenames_are_handled_without_panicking() {
        use std::ffi::OsString;
        use std::os::unix::ffi::OsStringExt;
        let root = temp_dir("non-utf8");
        let name = OsString::from_vec(b"Kick_\xff.wav".to_vec());
        fs::write(root.join(&name), wav_header()).unwrap();
        let scan = scan_pack(&root, PackFormat::Generic, false).unwrap();
        assert_eq!(scan.pack.samples.len(), 1);
        assert!(scan.pack.samples[0].name.contains('\u{fffd}'));
        fs::remove_dir_all(&root).ok();
    }
}
