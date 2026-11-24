//! Make command output cheap for an LLM (BRS 7.12): recognise common test and build runners and
//! return counts plus only the failures, and filter logs on the server (grep with context, errors
//! only, collapse repeated lines). Everything is a pure function over plain text; anything it
//! cannot recognise falls back to the error lines or the tail, never to silence.

use regex::Regex;

const MAX_ITEMS: usize = 8;
const MAX_LINE: usize = 180;

#[derive(Debug, PartialEq, Eq, Clone)]
pub struct Summary {
    pub tool: &'static str,
    pub ok: bool,
    pub headline: String,
    /// One entry per failing test: name, then up to two message lines.
    pub failures: Vec<String>,
    /// `file:line: message` for compile and type errors.
    pub errors: Vec<String>,
}

fn cut(s: &str) -> String {
    let t = s.trim();
    if t.chars().count() > MAX_LINE {
        format!("{}…", t.chars().take(MAX_LINE).collect::<String>())
    } else {
        t.to_string()
    }
}

fn re(p: &str) -> Regex {
    Regex::new(p).expect("static regex")
}

fn nums(s: &str) -> (u32, u32, u32) {
    let get = |w: &str| re(&format!(r"(\d+)\s+{w}")).captures(s).and_then(|c| c[1].parse().ok()).unwrap_or(0);
    (get("passed"), get("failed"), get("skipped"))
}

/// The next `n` non-empty lines after `i`.
fn following(lines: &[&str], i: usize, n: usize) -> Vec<String> {
    lines.iter().skip(i + 1).map(|l| l.trim()).filter(|l| !l.is_empty()).take(n).map(cut).collect()
}

// ------------------------------------------------------------------ parsers

fn vitest_or_jest(lines: &[&str]) -> Option<Summary> {
    let vitest = re(r"^\s*Tests\s{2,}(.*(?:passed|failed).*)$");
    let jest = re(r"^Tests:\s+(.*(?:passed|failed).*)$");
    let (idx, tool, tail) = lines.iter().enumerate().rev().find_map(|(i, l)| {
        vitest.captures(l).map(|c| (i, "vitest", c[1].to_string())).or_else(|| jest.captures(l).map(|c| (i, "jest", c[1].to_string())))
    })?;
    let _ = idx;
    let (p, f, s) = nums(&tail);
    let mut failures = Vec::new();
    for (i, l) in lines.iter().enumerate() {
        let t = l.trim();
        // vitest names failing tests on `FAIL` lines; jest's `FAIL` line names the suite, its `●` lines the tests
        let name = if tool == "vitest" {
            t.strip_prefix("FAIL ").map(|r| r.trim().to_string())
        } else {
            t.strip_prefix("● ").map(|r| r.to_string())
        };
        if let Some(n) = name {
            if n.contains("Test Suites") || failures.iter().any(|x: &String| x.starts_with(&n)) {
                continue;
            }
            let msg = following(lines, i, 2).join(" | ");
            failures.push(if msg.is_empty() { n } else { format!("{n}\n    {msg}") });
        }
    }
    Some(Summary { tool, ok: f == 0, headline: format!("{f} failed, {p} passed{}", if s > 0 { format!(", {s} skipped") } else { String::new() }), failures, errors: vec![] })
}

fn dotnet_test(lines: &[&str]) -> Option<Summary> {
    let r = re(r"(Passed|Failed)!\s+-\s+Failed:\s*(\d+),\s*Passed:\s*(\d+)(?:,\s*Skipped:\s*(\d+))?");
    let (f, p, s) = lines.iter().rev().find_map(|l| {
        r.captures(l).map(|c| (c[2].parse::<u32>().unwrap_or(0), c[3].parse::<u32>().unwrap_or(0), c.get(4).and_then(|x| x.as_str().parse::<u32>().ok()).unwrap_or(0)))
    })?;
    let mut failures = Vec::new();
    for (i, l) in lines.iter().enumerate() {
        let t = l.trim();
        if let Some(rest) = t.strip_prefix("Failed ") {
            if rest.contains('[') {
                let name = rest.split('[').next().unwrap_or(rest).trim().to_string();
                let msg = lines
                    .iter()
                    .skip(i + 1)
                    .take(6)
                    .map(|x| x.trim())
                    .skip_while(|x| *x != "Error Message:")
                    .skip(1)
                    .find(|x| !x.is_empty())
                    .map(cut)
                    .unwrap_or_default();
                failures.push(if msg.is_empty() { name } else { format!("{name}\n    {msg}") });
            }
        }
    }
    Some(Summary { tool: "dotnet test", ok: f == 0, headline: format!("{f} failed, {p} passed{}", if s > 0 { format!(", {s} skipped") } else { String::new() }), failures, errors: vec![] })
}

fn cargo_test(lines: &[&str]) -> Option<Summary> {
    let r = re(r"test result: (ok|FAILED)\. (\d+) passed; (\d+) failed(?:; (\d+) ignored)?");
    let (mut p, mut f, mut ig, mut any) = (0u32, 0u32, 0u32, false);
    for l in lines {
        if let Some(c) = r.captures(l) {
            any = true;
            p += c[2].parse::<u32>().unwrap_or(0);
            f += c[3].parse::<u32>().unwrap_or(0);
            ig += c.get(4).and_then(|x| x.as_str().parse::<u32>().ok()).unwrap_or(0);
        }
    }
    if !any {
        return None;
    }
    let mut failures = Vec::new();
    for (i, l) in lines.iter().enumerate() {
        if let Some(name) = l.trim().strip_prefix("---- ").and_then(|r| r.strip_suffix(" stdout ----")) {
            let msg = following(lines, i, 2).join(" | ");
            failures.push(if msg.is_empty() { name.to_string() } else { format!("{name}\n    {msg}") });
        }
    }
    Some(Summary { tool: "cargo test", ok: f == 0, headline: format!("{f} failed, {p} passed{}", if ig > 0 { format!(", {ig} ignored") } else { String::new() }), failures, errors: vec![] })
}

fn pytest(lines: &[&str]) -> Option<Summary> {
    let last = re(r"^=+\s*(.*?)\s+in\s+[\d.]+s.*=+$");
    let tail = lines.iter().rev().find_map(|l| last.captures(l.trim()).map(|c| c[1].to_string()))?;
    if !tail.contains("passed") && !tail.contains("failed") && !tail.contains("error") {
        return None;
    }
    let (p, f, s) = nums(&tail);
    let errs = re(r"(\d+)\s+errors?").captures(&tail).and_then(|c| c[1].parse::<u32>().ok()).unwrap_or(0);
    let failures: Vec<String> = lines.iter().filter_map(|l| l.trim().strip_prefix("FAILED ")).map(cut).collect();
    Some(Summary { tool: "pytest", ok: f + errs == 0, headline: format!("{} failed, {p} passed{}", f + errs, if s > 0 { format!(", {s} skipped") } else { String::new() }), failures, errors: vec![] })
}

fn go_test(lines: &[&str]) -> Option<Summary> {
    let fails: Vec<&&str> = lines.iter().filter(|l| l.starts_with("--- FAIL")).collect();
    let pkgs_ok = lines.iter().filter(|l| l.starts_with("ok ") && l.contains('\t')).count();
    let pkgs_bad = lines.iter().filter(|l| l.starts_with("FAIL\t")).count();
    if fails.is_empty() && pkgs_ok == 0 && pkgs_bad == 0 {
        return None;
    }
    let failures = lines
        .iter()
        .enumerate()
        .filter(|(_, l)| l.starts_with("--- FAIL"))
        .map(|(i, l)| {
            let name = l.trim_start_matches("--- FAIL:").trim().to_string();
            let msg = following(lines, i, 1).join(" | ");
            if msg.is_empty() { name } else { format!("{name}\n    {msg}") }
        })
        .collect();
    Some(Summary { tool: "go test", ok: fails.is_empty() && pkgs_bad == 0, headline: format!("{pkgs_bad} package(s) failed, {pkgs_ok} ok, {} test(s) failed", fails.len()), failures, errors: vec![] })
}

/// tsc, MSBuild/dotnet build and rustc style compile errors.
fn compiler_errors(lines: &[&str]) -> Option<Summary> {
    let tsc = re(r"^(.+?)\((\d+),\d+\):\s+error\s+([A-Z]+\d+):\s*(.+?)(?:\s+\[.*\])?$");
    let tsc2 = re(r"^(.+?):(\d+):\d+\s+-\s+error\s+([A-Z]+\d+):\s*(.+)$");
    let mut errors = Vec::new();
    let mut tool = "build";
    for (i, l) in lines.iter().enumerate() {
        let t = l.trim();
        if let Some(c) = tsc.captures(t).or_else(|| tsc2.captures(t)) {
            tool = if c[3].starts_with("TS") { "tsc" } else { "msbuild" };
            errors.push(format!("{}:{}: {} {}", c[1].trim(), &c[2], &c[3], cut(&c[4])));
        } else if t.starts_with("error[E") || (t.starts_with("error:") && !t.contains("could not compile")) {
            tool = "rustc";
            let loc = lines.iter().skip(i + 1).take(3).find_map(|x| x.trim().strip_prefix("--> ")).unwrap_or("");
            errors.push(format!("{}{}", if loc.is_empty() { String::new() } else { format!("{loc}: ") }, cut(t)));
        }
    }
    if errors.is_empty() {
        return None;
    }
    errors.dedup();
    let n = errors.len();
    Some(Summary { tool, ok: false, headline: format!("{n} error{}", if n == 1 { "" } else { "s" }), failures: vec![], errors })
}

pub fn summarize(text: &str) -> Option<Summary> {
    let lines: Vec<&str> = text.lines().collect();
    vitest_or_jest(&lines)
        .or_else(|| dotnet_test(&lines))
        .or_else(|| cargo_test(&lines))
        .or_else(|| pytest(&lines))
        .or_else(|| go_test(&lines))
        .or_else(|| compiler_errors(&lines))
}

// -------------------------------------------------------------------- brief

fn error_like(line: &str) -> bool {
    let l = line.to_lowercase();
    ["error", "fail", "exception", "panic", "fatal", "traceback", "unhandled", "cannot ", "refused", "denied", "✗", "×", "npm err"].iter().any(|k| l.contains(k))
}

/// The cheapest honest description of a finished command's output.
pub fn brief(text: &str, exit: Option<i32>, timed_out: bool) -> String {
    let status = if timed_out { "timed out".to_string() } else { exit.map(|c| format!("exit {c}")).unwrap_or_else(|| "no exit code".into()) };
    if let Some(s) = summarize(text) {
        let mut out = format!("{} {}: {}", s.tool, if s.ok { "OK" } else { "FAILED" }, s.headline);
        if exit.map(|c| c != 0).unwrap_or(false) && s.ok {
            out.push_str(&format!(" ({status})"));
        }
        for f in s.failures.iter().take(MAX_ITEMS) {
            out.push_str(&format!("\n✗ {f}"));
        }
        if s.failures.len() > MAX_ITEMS {
            out.push_str(&format!("\n… and {} more failures", s.failures.len() - MAX_ITEMS));
        }
        for e in s.errors.iter().take(MAX_ITEMS * 2) {
            out.push_str(&format!("\n✗ {e}"));
        }
        if s.errors.len() > MAX_ITEMS * 2 {
            out.push_str(&format!("\n… and {} more errors", s.errors.len() - MAX_ITEMS * 2));
        }
        return out;
    }
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    let n = lines.len();
    let bad: Vec<String> = lines.iter().filter(|l| error_like(l)).take(MAX_ITEMS * 2).map(|l| cut(l)).collect();
    if exit.map(|c| c != 0).unwrap_or(timed_out) && !bad.is_empty() {
        return format!("{status}, {n} lines, no known runner. Error lines:\n{}", bad.join("\n"));
    }
    let tail: Vec<String> = lines.iter().rev().take(if exit == Some(0) { 4 } else { 10 }).rev().map(|l| cut(l)).collect();
    format!("{status}, {n} lines. Last lines:\n{}", tail.join("\n"))
}

// ------------------------------------------------------------------ filters

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct FilterOpts {
    /// Keep lines containing any of these (case-insensitive); `a|b` means a or b.
    pub grep: Option<String>,
    /// Lines of context around each kept line.
    pub context: usize,
    /// Keep only error-looking lines (plus `context`, default 1 when set).
    pub errors: bool,
    /// Collapse runs of lines that differ only in numbers.
    pub dedupe: bool,
}

impl FilterOpts {
    pub fn is_empty(&self) -> bool {
        self.grep.is_none() && !self.errors && !self.dedupe
    }
}

fn shape(line: &str) -> String {
    re(r"\d+").replace_all(line.trim(), "#").to_string()
}

pub fn filter(text: &str, o: &FilterOpts) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let needles: Vec<String> = o.grep.as_deref().map(|g| g.split('|').map(|p| p.trim().to_lowercase()).filter(|p| !p.is_empty()).collect()).unwrap_or_default();
    let selecting = !needles.is_empty() || o.errors;
    let ctx = if o.errors && o.context == 0 && needles.is_empty() { 1 } else { o.context };
    let keep: Vec<bool> = if selecting {
        let hit: Vec<bool> = lines
            .iter()
            .map(|l| {
                let low = l.to_lowercase();
                (!needles.is_empty() && needles.iter().any(|n| low.contains(n.as_str()))) || (o.errors && error_like(l))
            })
            .collect();
        (0..lines.len()).map(|i| (i.saturating_sub(ctx)..=(i + ctx).min(lines.len().saturating_sub(1))).any(|j| hit[j])).collect()
    } else {
        vec![true; lines.len()]
    };
    let mut out: Vec<String> = Vec::new();
    let mut gap = false;
    let (mut run_shape, mut run_start, mut run_len) = (String::new(), 0usize, 0usize);
    let flush = |out: &mut Vec<String>, lines: &[&str], start: usize, len: usize| {
        if len > 1 {
            out.push(format!("{} (×{len} similar)", lines[start].trim_end()));
        } else if len == 1 {
            out.push(lines[start].trim_end().to_string());
        }
    };
    for (i, l) in lines.iter().enumerate() {
        if !keep[i] {
            if !gap && !out.is_empty() {
                if o.dedupe {
                    flush(&mut out, &lines, run_start, run_len);
                    run_len = 0;
                }
                out.push("--".into());
            }
            gap = true;
            continue;
        }
        gap = false;
        if o.dedupe {
            let s = shape(l);
            if run_len > 0 && s == run_shape && !s.is_empty() {
                run_len += 1;
            } else {
                flush(&mut out, &lines, run_start, run_len);
                run_shape = s;
                run_start = i;
                run_len = 1;
            }
        } else {
            out.push(l.trim_end().to_string());
        }
    }
    if o.dedupe {
        flush(&mut out, &lines, run_start, run_len);
    }
    while out.last().map(|l| l == "--").unwrap_or(false) {
        out.pop();
    }
    out.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    const VITEST_FAIL: &str = " ✓ src/a.test.ts (3 tests) 10ms\n ❯ src/b.test.ts (2 tests | 1 failed) 20ms\n   × b > adds numbers 3ms\n     → expected 3 to be 4\n FAIL  src/b.test.ts > b > adds numbers\nAssertionError: expected 3 to be 4\n ❯ src/b.test.ts:7:19\n\n Test Files  1 failed | 1 passed (2)\n      Tests  1 failed | 4 passed (5)\n   Duration  1.2s\n";
    const VITEST_OK: &str = " ✓ src/a.test.ts (3 tests) 10ms\n\n Test Files  2 passed (2)\n      Tests  5 passed (5)\n";
    const JEST_FAIL: &str = "FAIL src/sum.test.js\n  ● sum › adds\n\n    expect(received).toBe(expected)\n\n    Expected: 4\n\nTest Suites: 1 failed, 1 total\nTests:       1 failed, 2 passed, 3 total\n";
    const DOTNET_FAIL: &str = "Starting test execution\n  Failed Shop.Tests.CartTests.Total_adds_tax [12 ms]\n  Error Message:\n   Assert.Equal() Failure: Expected 11, Actual 10\n  Stack Trace:\n     at Shop.Tests.CartTests.Total_adds_tax() in C:\\x\\CartTests.cs:line 20\n\nFailed!  - Failed:     1, Passed:    41, Skipped:     2, Total:    44, Duration: 2 s\n";
    const DOTNET_OK: &str = "Passed!  - Failed:     0, Passed:   44, Skipped:     0, Total:    44, Duration: 2 s\n";
    const CARGO_FAIL: &str = "running 3 tests\ntest a ... ok\ntest b ... FAILED\n\nfailures:\n\n---- tests::b stdout ----\nthread 'tests::b' panicked at src/lib.rs:10:5:\nassertion `left == right` failed\n\ntest result: FAILED. 2 passed; 1 failed; 0 ignored; 0 measured\n";
    const CARGO_OK: &str = "test result: ok. 195 passed; 0 failed; 0 ignored\ntest result: ok. 43 passed; 0 failed; 0 ignored\n";
    const PYTEST: &str = "FAILED tests/test_a.py::test_x - AssertionError: assert 1 == 2\n=========== 1 failed, 4 passed in 0.52s ===========\n";
    const GO: &str = "--- FAIL: TestAdd (0.00s)\n    add_test.go:9: got 3 want 4\nFAIL\nFAIL\texample.com/m\t0.004s\nok  \texample.com/other\t0.002s\n";
    const TSC: &str = "src/App.tsx(12,5): error TS2322: Type 'string' is not assignable to type 'number'.\nsrc/a.ts(3,1): error TS2304: Cannot find name 'x'.\n\nFound 2 errors in 2 files.\n";
    const MSBUILD: &str = "C:\\p\\Cart.cs(14,9): error CS1002: ; expected [C:\\p\\Shop.csproj]\nBuild FAILED.\n    1 Error(s)\n";
    const RUSTC: &str = "error[E0425]: cannot find value `x` in this scope\n  --> src/main.rs:5:9\n   |\n5  |     x\nerror: could not compile `app` (bin \"app\") due to 1 previous error\n";

    #[test]
    fn vitest_failures_are_named_with_their_message() {
        let s = summarize(VITEST_FAIL).unwrap();
        assert_eq!((s.tool, s.ok, s.headline.as_str()), ("vitest", false, "1 failed, 4 passed"));
        assert!(s.failures[0].starts_with("src/b.test.ts > b > adds numbers"), "{:?}", s.failures);
        assert!(s.failures[0].contains("AssertionError"));
        let ok = summarize(VITEST_OK).unwrap();
        assert!(ok.ok && ok.failures.is_empty() && ok.headline == "0 failed, 5 passed");
    }

    #[test]
    fn jest_dotnet_cargo_pytest_go_are_recognised() {
        let j = summarize(JEST_FAIL).unwrap();
        assert_eq!((j.tool, j.headline.as_str()), ("jest", "1 failed, 2 passed"));
        assert!(j.failures[0].starts_with("sum › adds"));
        let d = summarize(DOTNET_FAIL).unwrap();
        assert_eq!((d.tool, d.headline.as_str()), ("dotnet test", "1 failed, 41 passed, 2 skipped"));
        assert!(d.failures[0].contains("Total_adds_tax") && d.failures[0].contains("Expected 11, Actual 10"), "{:?}", d.failures);
        assert!(summarize(DOTNET_OK).unwrap().ok);
        let c = summarize(CARGO_FAIL).unwrap();
        assert_eq!((c.tool, c.ok, c.headline.as_str()), ("cargo test", false, "1 failed, 2 passed"));
        assert!(c.failures[0].starts_with("tests::b") && c.failures[0].contains("src/lib.rs:10:5"));
        assert_eq!(summarize(CARGO_OK).unwrap().headline, "0 failed, 238 passed", "counts add up across test binaries");
        let p = summarize(PYTEST).unwrap();
        assert_eq!((p.tool, p.headline.as_str()), ("pytest", "1 failed, 4 passed"));
        assert!(p.failures[0].contains("test_a.py::test_x"));
        let g = summarize(GO).unwrap();
        assert_eq!((g.tool, g.ok), ("go test", false));
        assert!(g.failures[0].starts_with("TestAdd") && g.failures[0].contains("got 3 want 4"));
    }

    #[test]
    fn compiler_errors_become_file_line_message() {
        let t = summarize(TSC).unwrap();
        assert_eq!((t.tool, t.headline.as_str()), ("tsc", "2 errors"));
        assert_eq!(t.errors[0], "src/App.tsx:12: TS2322 Type 'string' is not assignable to type 'number'.");
        let m = summarize(MSBUILD).unwrap();
        assert_eq!(m.tool, "msbuild");
        assert!(m.errors[0].starts_with("C:\\p\\Cart.cs:14: CS1002"), "{:?}", m.errors);
        let r = summarize(RUSTC).unwrap();
        assert_eq!(r.tool, "rustc");
        assert_eq!(r.errors, vec!["src/main.rs:5:9: error[E0425]: cannot find value `x` in this scope".to_string()]);
    }

    #[test]
    fn unrecognised_output_returns_none_rather_than_guessing() {
        assert!(summarize("hello world\nall good\n").is_none());
        assert!(summarize("").is_none());
    }

    #[test]
    fn brief_is_tiny_compared_to_the_raw_output() {
        let noisy: String = (0..400).map(|i| format!("  ✓ case {i} passes 1ms\n")).collect::<String>() + VITEST_FAIL;
        let b = brief(&noisy, Some(1), false);
        assert!(b.starts_with("vitest FAILED: 1 failed, 4 passed"), "{b}");
        assert!(b.contains("✗ src/b.test.ts > b > adds numbers"));
        assert!(b.len() < noisy.len() / 20, "brief {} vs raw {}", b.len(), noisy.len());
    }

    #[test]
    fn brief_caps_the_number_of_failures_it_lists() {
        let mut t = String::new();
        for i in 0..30 {
            t.push_str(&format!(" FAIL  s{i}.test.ts > case {i}\nError: boom {i}\n"));
        }
        t.push_str("      Tests  30 failed | 0 passed (30)\n");
        let b = brief(&t, Some(1), false);
        assert_eq!(b.matches('✗').count(), 8);
        assert!(b.contains("… and 22 more failures"));
    }

    #[test]
    fn without_a_known_runner_failures_show_error_lines_and_successes_the_tail() {
        let log = "starting\nconnecting\nERROR: connection refused to db:5432\nretrying\nFatal: giving up\n";
        let b = brief(log, Some(1), false);
        assert!(b.starts_with("exit 1, 5 lines, no known runner") && b.contains("connection refused") && b.contains("Fatal: giving up"), "{b}");
        assert!(!b.contains("starting"));
        let ok = brief("a\nb\nc\nd\ne\nf\n", Some(0), false);
        assert!(ok.starts_with("exit 0, 6 lines. Last lines:") && ok.ends_with("c\nd\ne\nf"), "{ok}");
        assert!(brief("x\n", None, true).starts_with("timed out"));
    }

    #[test]
    fn a_nonzero_exit_with_a_green_summary_is_not_hidden() {
        let b = brief(VITEST_OK, Some(1), false);
        assert!(b.contains("vitest OK") && b.contains("(exit 1)"), "{b}");
    }

    // ---- filters
    const LOG: &str = "boot ok\nGET /a 200\nGET /b 200\nERROR db down\nretry 1\nretry 2\nretry 3\nGET /c 500\ndone\n";

    #[test]
    fn grep_keeps_matching_lines_with_context_and_separators() {
        let o = FilterOpts { grep: Some("error".into()), ..Default::default() };
        assert_eq!(filter(LOG, &o), "ERROR db down");
        let o = FilterOpts { grep: Some("error".into()), context: 1, ..Default::default() };
        assert_eq!(filter(LOG, &o), "GET /b 200\nERROR db down\nretry 1");
        let o = FilterOpts { grep: Some("boot|done".into()), ..Default::default() };
        assert_eq!(filter(LOG, &o), "boot ok\n--\ndone");
    }

    #[test]
    fn errors_only_keeps_error_looking_lines_with_a_line_of_context() {
        let o = FilterOpts { errors: true, ..Default::default() };
        let out = filter(LOG, &o);
        assert!(out.contains("ERROR db down") && out.contains("GET /b 200") && out.contains("retry 1"));
        assert!(!out.contains("boot ok") && !out.contains("retry 3"));
    }

    #[test]
    fn dedupe_collapses_lines_that_differ_only_in_numbers() {
        let o = FilterOpts { dedupe: true, ..Default::default() };
        let out = filter(LOG, &o);
        assert!(out.contains("GET /a 200") && out.contains("GET /b 200"), "different words are never merged: {out}");
        let items = "GET /item/1 200\nGET /item/2 200\nGET /item/3 200\n";
        assert_eq!(filter(items, &o), "GET /item/1 200 (×3 similar)");
        assert!(out.contains("retry 1 (×3 similar)"), "{out}");
        assert!(out.contains("GET /c 500") && !out.contains("GET /c 500 ("), "a lone line is untouched");
        let progress: String = (1..=100).map(|i| format!("downloading {i}%\n")).collect();
        assert_eq!(filter(&progress, &o), "downloading 1% (×100 similar)");
    }

    #[test]
    fn no_options_returns_the_text_unchanged_and_filters_combine() {
        assert!(FilterOpts::default().is_empty());
        assert_eq!(filter("a\nb", &FilterOpts::default()), "a\nb");
        let o = FilterOpts { grep: Some("retry|error".into()), dedupe: true, ..Default::default() };
        let out = filter(LOG, &o);
        assert!(out.contains("ERROR db down") && out.contains("retry 1 (×3 similar)"), "{out}");
    }
}
