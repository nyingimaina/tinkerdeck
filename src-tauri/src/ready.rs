//! Readiness checks for `app.up` with `wait` (BRS 7.12): a terminal is ready when its output
//! contains a pattern or a local URL answers. Only loopback addresses are ever requested, so a
//! saved terminal can never make the launcher call out to the internet.

use std::time::Duration;

/// `http(s)://localhost|127.0.0.1|[::1]` (with optional port and path) and nothing else.
pub fn is_loopback_url(url: &str) -> bool {
    let rest = match url.strip_prefix("http://").or_else(|| url.strip_prefix("https://")) {
        Some(r) => r,
        None => return false,
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.contains('@') || authority.is_empty() {
        return false;
    }
    let host = if let Some(v6) = authority.strip_prefix('[') {
        v6.split(']').next().unwrap_or("")
    } else {
        authority.split(':').next().unwrap_or("")
    };
    matches!(host.to_ascii_lowercase().as_str(), "localhost" | "127.0.0.1" | "::1")
}

/// Does something answer at this local URL? Any HTTP answer below 500 counts: a 404 from a router
/// still proves the server is up.
pub fn http_answers(url: &str) -> bool {
    if !is_loopback_url(url) {
        return false;
    }
    let agent = ureq::AgentBuilder::new().timeout_connect(Duration::from_millis(800)).timeout(Duration::from_millis(1500)).redirects(0).build();
    match agent.get(url).call() {
        Ok(r) => r.status() < 500,
        Err(ureq::Error::Status(code, _)) => code < 500,
        Err(_) => false,
    }
}

/// Case-insensitive "does the output contain the pattern" (a plain substring, no regex).
pub fn output_has(text: &str, pattern: &str) -> bool {
    let p = pattern.trim().to_lowercase();
    !p.is_empty() && text.to_lowercase().contains(&p)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::update::tests::{ok, serve_with};
    use std::collections::HashMap;

    #[test]
    fn only_loopback_urls_are_allowed() {
        for good in ["http://localhost:5173", "http://127.0.0.1:8080/health", "https://localhost/", "http://[::1]:3000/x", "HTTP://LOCALHOST"] {
            assert_eq!(is_loopback_url(good), good != "HTTP://LOCALHOST", "{good}"); // scheme is case-sensitive on purpose
        }
        for bad in ["http://example.com", "http://localhost.evil.com/", "http://127.0.0.1.evil.com", "http://user@localhost/", "ftp://localhost", "localhost:5173", "", "http://", "http://192.168.1.5:80", "http://0.0.0.0:80"] {
            assert!(!is_loopback_url(bad), "{bad}");
        }
    }

    #[test]
    fn a_local_server_that_answers_is_ready_even_with_a_404_but_a_500_or_nothing_is_not() {
        let s = serve_with(|_| {
            let mut r = HashMap::new();
            r.insert("/ok".to_string(), ok(b"hi".to_vec()));
            r.insert("/boom".to_string(), (500, vec![], b"x".to_vec()));
            r
        });
        assert!(http_answers(&format!("{}/ok", s.base)));
        assert!(http_answers(&format!("{}/missing", s.base)), "404 still proves the server is up");
        assert!(!http_answers(&format!("{}/boom", s.base)));
        let dead = {
            let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            format!("http://127.0.0.1:{}/", l.local_addr().unwrap().port())
        };
        assert!(!http_answers(&dead));
        assert!(!http_answers("http://example.com/"), "never leaves the machine");
    }

    #[test]
    fn output_matching_is_a_case_insensitive_substring() {
        assert!(output_has("  Local:   http://localhost:5173/", "local:"));
        assert!(output_has("Now listening on: http://localhost:5000", "NOW LISTENING ON"));
        assert!(!output_has("compiling...", "ready"));
        assert!(!output_has("anything", "  "), "an empty pattern never matches");
    }
}
