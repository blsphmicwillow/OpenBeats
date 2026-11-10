//! JSON theme engine.
//!
//! A theme file is `{ "name": "...", "colors": { "bg": "#101014", ... } }`. The
//! keys become CSS custom properties (`--bg`) that the React shell applies to the
//! document root. Values are validated so a shared theme file cannot smuggle
//! extra CSS declarations into the app.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// A theme file as written by the export button.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct ThemeFile {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub colors: BTreeMap<String, String>,
}

/// Validated CSS custom properties for the UI to apply.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CssVariables {
    pub name: String,
    /// `("--bg", "#101014")` pairs.
    pub variables: Vec<(String, String)>,
}

fn variable_name(key: &str) -> Result<String, String> {
    let trimmed = key.trim().trim_start_matches("--").to_lowercase();
    let valid = !trimmed.is_empty()
        && trimmed.len() <= 64
        && trimmed
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if valid {
        Ok(trimmed)
    } else {
        Err(format!("\"{key}\" is not a valid colour name"))
    }
}

/// Accepts colours and simple functions only; rejects anything that could close
/// the declaration or pull in a remote resource.
fn variable_value(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    let lower = trimmed.to_lowercase();
    let safe_chars = trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || " #(),.%+-/".contains(c));
    let safe_function = ["rgb(", "rgba(", "hsl(", "hsla("]
        .iter()
        .any(|prefix| lower.starts_with(prefix));
    let safe = !trimmed.is_empty()
        && trimmed.len() <= 96
        && safe_chars
        && !lower.contains("url(")
        && (lower.starts_with('#')
            || safe_function
            || lower.chars().all(|c| c.is_ascii_alphabetic()));
    if safe {
        Ok(trimmed.to_string())
    } else {
        Err(format!("\"{value}\" is not a supported colour value"))
    }
}

/// Parses a theme file into CSS variables.
pub fn css_variables(json: &str) -> Result<CssVariables, String> {
    let theme: ThemeFile =
        serde_json::from_str(json).map_err(|err| format!("invalid theme JSON: {err}"))?;
    if theme.colors.is_empty() {
        return Err("the theme defines no colours".into());
    }
    let mut variables = Vec::with_capacity(theme.colors.len());
    for (key, value) in &theme.colors {
        variables.push((format!("--{}", variable_name(key)?), variable_value(value)?));
    }
    Ok(CssVariables {
        name: theme.name.unwrap_or_else(|| "custom".into()),
        variables,
    })
}

impl CssVariables {
    /// The whole theme as a CSS declaration block for `:root`.
    pub fn stylesheet(&self) -> String {
        let body: String = self
            .variables
            .iter()
            .map(|(name, value)| format!("  {name}: {value};\n"))
            .collect();
        format!(":root {{\n{body}}}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colours_become_css_variables() {
        let theme =
            css_variables(r##"{"name":"Midnight","colors":{"bg":"#101014","accent":"#4fd1c5"}}"##)
                .unwrap();
        assert_eq!(theme.name, "Midnight");
        assert!(theme
            .variables
            .contains(&("--accent".into(), "#4fd1c5".into())));
    }

    #[test]
    fn function_colours_are_allowed() {
        let theme =
            css_variables(r#"{"colors":{"panel":"rgb(12, 14, 20)","soft":"rgba(255,0,0,0.2)"}}"#)
                .unwrap();
        assert_eq!(theme.variables.len(), 2);
    }

    #[test]
    fn a_leading_double_dash_is_not_doubled() {
        let theme = css_variables(r##"{"colors":{"--bg":"#000000"}}"##).unwrap();
        assert_eq!(theme.variables[0].0, "--bg");
    }

    #[test]
    fn injected_declarations_are_rejected() {
        let err =
            css_variables(r##"{"colors":{"bg":"#000; background:url(https://x)"}}"##).unwrap_err();
        assert!(err.contains("not a supported colour"), "{err}");
    }

    #[test]
    fn invalid_multiple_declarations_or_braces_are_rejected() {
        assert!(css_variables(r##"{"colors":{"bg":"#fff}"}}"##).is_err());
        assert!(css_variables(r##"{"colors":{"bg":"url(#x)"}}"##).is_err());
    }

    #[test]
    fn keys_must_be_plain_names() {
        assert!(css_variables(r##"{"colors":{"background-color":"#fff"}}"##).is_ok());
        let err = css_variables(r##"{"colors":{"bg; color":"#fff"}}"##).unwrap_err();
        assert!(err.contains("not a valid colour name"), "{err}");
    }

    #[test]
    fn an_empty_theme_is_an_error() {
        assert!(css_variables(r#"{"colors":{}}"#).is_err());
        assert!(css_variables("not json").is_err());
    }

    #[test]
    fn stylesheet_wraps_every_variable() {
        let theme = css_variables(r##"{"colors":{"bg":"#000000"}}"##).unwrap();
        assert_eq!(theme.stylesheet(), ":root {\n  --bg: #000000;\n}");
    }
}
