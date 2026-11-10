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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallerKind {
    AppImage,
    Deb,
    Rpm,
    Msi,
    Nsis,
    Dmg,
    AppTarGz,
}

/// Classifies a release asset by the installer it contains.
pub fn installer_kind(name: &str) -> Option<InstallerKind> {
    let name = name.to_ascii_lowercase();
    if name.ends_with(".appimage") {
        Some(InstallerKind::AppImage)
    } else if name.ends_with(".deb") {
        Some(InstallerKind::Deb)
    } else if name.ends_with(".rpm") {
        Some(InstallerKind::Rpm)
    } else if name.ends_with(".msi") {
        Some(InstallerKind::Msi)
    } else if name.ends_with(".exe") {
        Some(InstallerKind::Nsis)
    } else if name.ends_with(".dmg") {
        Some(InstallerKind::Dmg)
    } else if name.ends_with(".app.tar.gz") || name.ends_with(".tar.gz") {
        Some(InstallerKind::AppTarGz)
    } else {
        None
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

/// Checks that `url` is an installer asset on this project's releases and
/// returns its file name. Anything else is refused before a download starts.
pub fn validate_installer_url(url: &str) -> Result<String, String> {
    const PREFIX: &str = "https://github.com/blsphmicwillow/OpenBeats/releases/download/";
    let url = url.trim();
    if !url.starts_with(PREFIX) {
        return Err("refusing to install an update from an unknown source".into());
    }
    let name = url
        .rsplit('/')
        .next()
        .unwrap_or("")
        .split('?')
        .next()
        .unwrap_or("");
    if name.is_empty() || name.contains("..") || name.contains('\\') || name.contains('/') {
        return Err("the update URL does not name a file".into());
    }
    if installer_kind(name).is_none() {
        return Err("the update asset is not a supported installer".into());
    }
    Ok(name.to_string())
}

fn installer_rank(
    kind: InstallerKind,
    os: &str,
    appimage: bool,
    debian: bool,
    rpm: bool,
) -> Option<u8> {
    match os.to_ascii_lowercase().as_str() {
        "linux" => match kind {
            // An AppImage can only replace an AppImage that is running. For a
            // deb/rpm install, pick the package the system can actually use.
            InstallerKind::AppImage if appimage => Some(100),
            InstallerKind::Deb if debian => Some(99),
            InstallerKind::Rpm if rpm => Some(99),
            InstallerKind::AppImage => Some(80),
            InstallerKind::Deb => Some(70),
            InstallerKind::Rpm => Some(60),
            _ => None,
        },
        "windows" => match kind {
            InstallerKind::Msi => Some(100),
            InstallerKind::Nsis => Some(90),
            _ => None,
        },
        "macos" | "mac" | "darwin" => match kind {
            InstallerKind::Dmg => Some(100),
            InstallerKind::AppTarGz => Some(80),
            _ => None,
        },
        _ => None,
    }
}

/// Selects the installer that matches how OpenBeats is currently installed.
pub fn pick_for_installation(
    assets: &[(String, String)],
    os: &str,
    appimage: bool,
    debian: bool,
    rpm: bool,
) -> Option<(String, String)> {
    assets
        .iter()
        .filter_map(|(name, url)| {
            let kind = installer_kind(name)?;
            installer_rank(kind, os, appimage, debian, rpm).map(|rank| (rank, name, url))
        })
        .max_by_key(|(rank, _, _)| *rank)
        .map(|(_, name, url)| (name.clone(), url.clone()))
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
    fn installer_urls_must_point_at_our_github_releases() {
        assert_eq!(
            validate_installer_url(
                "https://github.com/blsphmicwillow/OpenBeats/releases/download/v1.0.2/OpenBeats_1.0.2_amd64.AppImage"
            )
            .unwrap(),
            "OpenBeats_1.0.2_amd64.AppImage"
        );
        assert!(validate_installer_url("https://evil.test/OpenBeats.AppImage").is_err());
        assert!(validate_installer_url(
            "https://github.com/blsphmicwillow/OpenBeats/releases/download/v1/..%2f..%2fetc%2fpasswd"
        )
        .is_err());
        assert!(validate_installer_url(
            "https://github.com/other/repo/releases/download/v1/a.AppImage"
        )
        .is_err());
    }

    #[test]
    fn installer_kinds_cover_every_release_asset() {
        assert_eq!(
            installer_kind("OpenBeats_x86_64.AppImage"),
            Some(InstallerKind::AppImage)
        );
        assert_eq!(
            installer_kind("OpenBeats_amd64.deb"),
            Some(InstallerKind::Deb)
        );
        assert_eq!(
            installer_kind("OpenBeats_x86_64.rpm"),
            Some(InstallerKind::Rpm)
        );
        assert_eq!(
            installer_kind("OpenBeats_x64_en-US.msi"),
            Some(InstallerKind::Msi)
        );
        assert_eq!(
            installer_kind("OpenBeats_x64-setup.exe"),
            Some(InstallerKind::Nsis)
        );
        assert_eq!(
            installer_kind("OpenBeats_aarch64.dmg"),
            Some(InstallerKind::Dmg)
        );
        assert_eq!(
            installer_kind("OpenBeats_aarch64.app.tar.gz"),
            Some(InstallerKind::AppTarGz)
        );
        assert_eq!(installer_kind("latest.json"), None);
    }

    #[test]
    fn installation_picks_the_asset_that_matches_the_running_package() {
        let assets = vec![
            ("OpenBeats.AppImage".to_string(), "a".to_string()),
            ("OpenBeats.deb".to_string(), "d".to_string()),
            ("OpenBeats.rpm".to_string(), "r".to_string()),
        ];
        assert_eq!(
            pick_for_installation(&assets, "linux", true, false, false)
                .unwrap()
                .1,
            "a"
        );
        assert_eq!(
            pick_for_installation(&assets, "linux", false, true, false)
                .unwrap()
                .1,
            "d"
        );
        assert_eq!(
            pick_for_installation(&assets, "linux", false, false, true)
                .unwrap()
                .1,
            "r"
        );
        assert_eq!(
            pick_for_installation(
                &[("OpenBeats.msi".to_string(), "m".to_string())],
                "windows",
                false,
                false,
                false,
            )
            .unwrap()
            .1,
            "m"
        );
        assert_eq!(
            pick_for_installation(
                &[("OpenBeats.dmg".to_string(), "d".to_string())],
                "macos",
                false,
                false,
                false,
            )
            .unwrap()
            .1,
            "d"
        );
    }

    #[test]
    fn non_installer_assets_are_refused() {
        assert!(validate_installer_url(
            "https://github.com/blsphmicwillow/OpenBeats/releases/download/v1/latest.json"
        )
        .is_err());
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
