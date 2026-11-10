//! GitHub release parsing for the update checker.
//!
//! Pure JSON-to-struct logic, so the whole comparison and asset selection is
//! testable without a network call.

use serde::{Deserialize, Serialize};
use std::cmp::Ordering;

#[derive(Debug, Clone, Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
    #[serde(default)]
    size: u64,
}

#[derive(Debug, Clone, Deserialize)]
struct GhRelease {
    tag_name: String,
    #[serde(default)]
    body: Option<String>,
    html_url: String,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    assets: Vec<GhAsset>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct UpdateAsset {
    pub name: String,
    pub url: String,
    pub size: u64,
    /// True when the asset matches the running platform.
    pub recommended: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub notes: String,
    pub url: String,
    pub published_at: Option<String>,
    pub newer: bool,
    pub assets: Vec<UpdateAsset>,
    /// Direct download for this platform, when a matching asset exists.
    pub download_url: Option<String>,
}

/// Compares dotted versions, ignoring a leading `v` and build metadata.
pub fn compare(left: &str, right: &str) -> Ordering {
    fn parts(value: &str) -> Vec<u64> {
        value
            .trim()
            .trim_start_matches(['v', 'V'])
            .split(['-', '+'])
            .next()
            .unwrap_or("0")
            .split('.')
            .map(|part| {
                part.chars()
                    .take_while(|c| c.is_ascii_digit())
                    .collect::<String>()
                    .parse::<u64>()
                    .unwrap_or(0)
            })
            .collect()
    }
    let a = parts(left);
    let b = parts(right);
    for index in 0..a.len().max(b.len()) {
        let left = a.get(index).copied().unwrap_or(0);
        let right = b.get(index).copied().unwrap_or(0);
        match left.cmp(&right) {
            Ordering::Equal => continue,
            other => return other,
        }
    }
    Ordering::Equal
}

fn platform_matches(name: &str, os: &str, arch: &str) -> bool {
    let name = name.to_lowercase();
    let os = os.to_lowercase();
    let arch = arch.to_lowercase();
    let os_ok = match os.as_str() {
        "windows" => name.ends_with(".msi") || name.ends_with(".exe"),
        "macos" | "mac" | "darwin" => name.ends_with(".dmg") || name.ends_with(".tar.gz"),
        "linux" => name.ends_with(".appimage") || name.ends_with(".deb") || name.ends_with(".rpm"),
        _ => false,
    };
    if !os_ok {
        return false;
    }
    let wants_arm = arch.contains("aarch64") || arch.contains("arm64");
    let has_arm = name.contains("aarch64") || name.contains("arm64");
    let has_x64 = name.contains("x64") || name.contains("x86_64") || name.contains("amd64");
    if wants_arm {
        has_arm && !has_x64
    } else {
        !has_arm
    }
}

/// Picks the best asset for the platform: AppImage over deb/rpm, msi over exe.
fn score(name: &str, os: &str) -> u8 {
    let name = name.to_lowercase();
    match os.to_lowercase().as_str() {
        "linux" if name.ends_with(".appimage") => 3,
        "linux" if name.ends_with(".deb") => 2,
        "linux" if name.ends_with(".rpm") => 1,
        "windows" if name.ends_with(".msi") => 3,
        "windows" if name.ends_with(".exe") => 2,
        "macos" | "mac" | "darwin" if name.ends_with(".dmg") => 3,
        _ => 0,
    }
}

/// Parses the GitHub `/releases/latest` payload.
///
/// Returns `Ok(None)` when the running version is current, and an error when the
/// payload is not a release object (rate-limit body, HTML error page, …).
pub fn parse(
    json: &str,
    current_version: &str,
    os: &str,
    arch: &str,
) -> Result<Option<UpdateInfo>, String> {
    let release: GhRelease =
        serde_json::from_str(json).map_err(|e| format!("bad release JSON: {e}"))?;
    if release.draft || release.prerelease {
        return Ok(None);
    }
    let version = release.tag_name.trim_start_matches(['v', 'V']).to_string();
    if version.is_empty() {
        return Err("the release has no tag".into());
    }
    let newer = compare(&version, current_version) == Ordering::Greater;

    let mut assets: Vec<UpdateAsset> = release
        .assets
        .iter()
        .map(|asset| UpdateAsset {
            name: asset.name.clone(),
            url: asset.browser_download_url.clone(),
            size: asset.size,
            recommended: platform_matches(&asset.name, os, arch),
        })
        .collect();
    assets.sort_by_key(|asset| std::cmp::Reverse((asset.recommended, score(&asset.name, os))));
    let download_url = assets
        .iter()
        .find(|asset| asset.recommended)
        .map(|asset| asset.url.clone());

    Ok(Some(UpdateInfo {
        version,
        notes: release.body.unwrap_or_default(),
        url: release.html_url,
        published_at: release.published_at,
        newer,
        assets,
        download_url,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r#"{
        "tag_name": "v1.0.2",
        "body": "Fixes the export dialog.",
        "html_url": "https://github.com/blsphmicwillow/OpenBeats/releases/tag/v1.0.2",
        "published_at": "2026-12-01T10:00:00Z",
        "prerelease": false,
        "draft": false,
        "assets": [
            {"name": "OpenBeats_1.0.2_amd64.AppImage", "browser_download_url": "https://example.test/app.AppImage", "size": 10},
            {"name": "OpenBeats_1.0.2_amd64.deb", "browser_download_url": "https://example.test/app.deb", "size": 11},
            {"name": "OpenBeats_1.0.2_x64-setup.exe", "browser_download_url": "https://example.test/app.exe", "size": 12},
            {"name": "OpenBeats_1.0.2_aarch64.dmg", "browser_download_url": "https://example.test/app.dmg", "size": 13}
        ]
    }"#;

    #[test]
    fn a_newer_release_is_reported_with_a_platform_download() {
        let update = parse(FIXTURE, "1.0.1", "linux", "x86_64").unwrap().unwrap();
        assert!(update.newer);
        assert_eq!(update.version, "1.0.2");
        assert_eq!(update.notes, "Fixes the export dialog.");
        assert_eq!(
            update.download_url.as_deref(),
            Some("https://example.test/app.AppImage")
        );
    }

    #[test]
    fn windows_gets_the_msi_and_mac_gets_the_dmg() {
        let windows = parse(FIXTURE, "1.0.0", "windows", "x86_64")
            .unwrap()
            .unwrap();
        assert_eq!(
            windows.download_url.as_deref(),
            Some("https://example.test/app.exe")
        );
        let mac = parse(FIXTURE, "1.0.0", "macos", "aarch64")
            .unwrap()
            .unwrap();
        assert_eq!(
            mac.download_url.as_deref(),
            Some("https://example.test/app.dmg")
        );
    }

    #[test]
    fn the_same_or_older_version_is_not_newer() {
        let same = parse(FIXTURE, "1.0.2", "linux", "x86_64").unwrap().unwrap();
        assert!(!same.newer);
        let older = parse(FIXTURE, "2.0.0", "linux", "x86_64").unwrap().unwrap();
        assert!(!older.newer);
    }

    #[test]
    fn version_comparison_handles_prefixes_and_padding() {
        assert_eq!(compare("v1.0.2", "1.0.1"), Ordering::Greater);
        assert_eq!(compare("1.0", "1.0.0"), Ordering::Equal);
        assert_eq!(compare("1.10.0", "1.9.9"), Ordering::Greater);
        // Prerelease suffixes are ignored: only the dotted numbers count.
        assert_eq!(compare("v2.0.0-beta", "2.0.0"), Ordering::Equal);
        assert_eq!(compare("2.1.0-beta", "2.0.0"), Ordering::Greater);
    }

    #[test]
    fn bad_payloads_and_prereleases_are_rejected_quietly() {
        assert!(parse(
            "{\"message\":\"API rate limit exceeded\"}",
            "1.0.0",
            "linux",
            "x86_64"
        )
        .is_err());
        assert!(parse("<html>nope</html>", "1.0.0", "linux", "x86_64").is_err());
        let prerelease = FIXTURE.replace("\"prerelease\": false", "\"prerelease\": true");
        assert!(parse(&prerelease, "1.0.0", "linux", "x86_64")
            .unwrap()
            .is_none());
    }
}
