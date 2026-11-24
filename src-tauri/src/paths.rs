//! Working-directory resolution and path normalisation (BRS 5.2, pitfalls 9 and 17).

use std::path::{Path, PathBuf};

/// Turn forward slashes into backslashes (Windows), trim whitespace and quotes.
pub fn normalize_slashes(p: &str) -> String {
    p.trim().trim_matches('"').replace('/', "\\")
}

fn is_absolute(p: &str) -> bool {
    let b = p.as_bytes();
    // C:\..., C:/..., \\server\share
    (b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/'))
        || p.starts_with("\\\\")
}

/// Resolve a terminal's folder: absolute `cwd` wins, otherwise join to `root`.
/// Empty `cwd` or "." means the root itself.
pub fn resolve_cwd(root: &str, cwd: &str) -> PathBuf {
    let root = normalize_slashes(root);
    let cwd = normalize_slashes(cwd);
    if cwd.is_empty() || cwd == "." {
        return PathBuf::from(root);
    }
    if is_absolute(&cwd) {
        return PathBuf::from(cwd);
    }
    Path::new(&root).join(cwd)
}

pub fn missing_folder_message(path: &Path) -> String {
    format!("The folder \"{}\" does not exist.", path.display())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dot_means_root() {
        assert_eq!(resolve_cwd("E:\\code\\Q", "."), PathBuf::from("E:\\code\\Q"));
        assert_eq!(resolve_cwd("E:\\code\\Q", ""), PathBuf::from("E:\\code\\Q"));
    }

    #[test]
    fn relative_is_joined_to_root_not_launcher_folder() {
        assert_eq!(resolve_cwd("E:\\code\\Q", "backend\\Api"), PathBuf::from("E:\\code\\Q\\backend\\Api"));
    }

    #[test]
    fn forward_slashes_are_normalised() {
        assert_eq!(resolve_cwd("E:/code/Q", "backend/Api"), PathBuf::from("E:\\code\\Q\\backend\\Api"));
    }

    #[test]
    fn absolute_cwd_wins_over_root() {
        assert_eq!(resolve_cwd("E:\\code\\Q", "D:\\other"), PathBuf::from("D:\\other"));
        assert_eq!(resolve_cwd("E:\\code\\Q", "D:/other"), PathBuf::from("D:\\other"));
        assert_eq!(resolve_cwd("E:\\code\\Q", "\\\\srv\\share"), PathBuf::from("\\\\srv\\share"));
    }

    #[test]
    fn quotes_and_spaces_are_trimmed() {
        assert_eq!(resolve_cwd("\"E:\\my code\"", " sub "), PathBuf::from("E:\\my code\\sub"));
    }

    #[test]
    fn message_names_the_folder() {
        let m = missing_folder_message(Path::new("E:\\nope"));
        assert!(m.contains("E:\\nope") && m.contains("does not exist"));
    }
}
