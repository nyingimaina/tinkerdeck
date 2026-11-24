//! Turn raw terminal bytes into the plain text an LLM (or a person reading `tdk logs`) wants:
//! no colour codes, no cursor movement, carriage-return progress bars collapsed to their last state.

/// Strip escape sequences and apply `\r` / backspace / `ESC c` the way a terminal would.
pub fn strip_ansi(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    let mut lines: Vec<String> = vec![String::new()];
    let mut cur: Vec<char> = Vec::new(); // current line being built (so \r can overwrite)
    let mut col = 0usize;
    let mut chars = text.chars().peekable();

    let flush = |lines: &mut Vec<String>, cur: &mut Vec<char>| {
        if let Some(last) = lines.last_mut() {
            *last = cur.iter().collect();
        }
    };

    while let Some(c) = chars.next() {
        match c {
            '\u{1b}' => match chars.peek().copied() {
                Some('[') => {
                    chars.next();
                    // CSI: parameters then a final byte 0x40..=0x7E
                    for n in chars.by_ref() {
                        if ('\u{40}'..='\u{7e}').contains(&n) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    chars.next();
                    // OSC: until BEL or ST (ESC \)
                    while let Some(n) = chars.next() {
                        if n == '\u{7}' {
                            break;
                        }
                        if n == '\u{1b}' {
                            if chars.peek() == Some(&'\\') {
                                chars.next();
                            }
                            break;
                        }
                    }
                }
                Some('c') => {
                    chars.next();
                    // full reset: forget everything so far (a restarted terminal)
                    lines.clear();
                    lines.push(String::new());
                    cur.clear();
                    col = 0;
                }
                Some(_) => {
                    chars.next(); // two-character escape such as ESC ( B
                    if matches!(chars.peek(), Some('B') | Some('0')) {
                        chars.next();
                    }
                }
                None => {}
            },
            '\r' => col = 0,
            '\n' => {
                flush(&mut lines, &mut cur);
                lines.push(String::new());
                cur.clear();
                col = 0;
            }
            '\u{8}' => col = col.saturating_sub(1),
            '\u{7}' => {}
            c if c.is_control() && c != '\t' => {}
            c => {
                if col < cur.len() {
                    cur[col] = c;
                } else {
                    cur.push(c);
                }
                col += 1;
            }
        }
    }
    flush(&mut lines, &mut cur);
    let mut out = lines.into_iter().map(|l| l.trim_end().to_string()).collect::<Vec<_>>().join("\n");
    while out.ends_with('\n') {
        out.pop();
    }
    out
}

/// The last `n` lines, at most `max_chars` characters (keeping the end), and whether anything was cut.
pub fn tail(text: &str, n: usize, max_chars: usize) -> (String, bool) {
    let lines: Vec<&str> = text.lines().collect();
    let start = lines.len().saturating_sub(n);
    let mut out = lines[start..].join("\n");
    let mut cut = start > 0;
    let count = out.chars().count();
    if count > max_chars {
        out = out.chars().skip(count - max_chars).collect();
        cut = true;
    }
    (out, cut)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_text_passes_through() {
        assert_eq!(strip_ansi(b"hello\nworld\n"), "hello\nworld");
    }

    #[test]
    fn colours_and_cursor_codes_are_removed() {
        assert_eq!(strip_ansi(b"\x1b[31mred\x1b[0m and \x1b[1;32mgreen\x1b[0m"), "red and green");
        assert_eq!(strip_ansi(b"a\x1b[2K\x1b[1Gb"), "ab");
        assert_eq!(strip_ansi(b"\x1b[?25lhidden cursor\x1b[?25h"), "hidden cursor");
    }

    #[test]
    fn osc_titles_are_removed_with_bel_or_st() {
        assert_eq!(strip_ansi(b"\x1b]0;my title\x07prompt>"), "prompt>");
        assert_eq!(strip_ansi(b"\x1b]0;title\x1b\\prompt>"), "prompt>");
    }

    #[test]
    fn carriage_return_progress_bars_collapse_to_the_last_state() {
        assert_eq!(strip_ansi(b"10%\r50%\r100%\ndone"), "100%\ndone");
        assert_eq!(strip_ansi(b"abcdef\rXY"), "XYcdef");
    }

    #[test]
    fn crlf_lines_and_backspace() {
        assert_eq!(strip_ansi(b"one\r\ntwo\r\n"), "one\ntwo");
        assert_eq!(strip_ansi(b"abc\x08\x08X"), "aXc");
    }

    #[test]
    fn terminal_reset_forgets_earlier_output() {
        assert_eq!(strip_ansi(b"old stuff\n\x1bcnew run\n"), "new run");
    }

    #[test]
    fn utf8_and_split_sequences_survive() {
        assert_eq!(strip_ansi("héllo ✓ 日本".as_bytes()), "héllo ✓ 日本");
        assert_eq!(strip_ansi(b"ok\x1b[3"), "ok"); // truncated escape at the end of the buffer
        assert_eq!(strip_ansi(&[b'a', 0xff, b'b']), "a\u{fffd}b"); // invalid byte does not panic
    }

    #[test]
    fn trailing_spaces_are_trimmed_and_tabs_kept() {
        assert_eq!(strip_ansi(b"a   \n\tb  "), "a\n\tb");
    }

    #[test]
    fn tail_keeps_the_end_and_reports_cuts() {
        let t = "1\n2\n3\n4\n5";
        assert_eq!(tail(t, 2, 1000), ("4\n5".to_string(), true));
        assert_eq!(tail(t, 10, 1000), (t.to_string(), false));
        let (s, cut) = tail("abcdefghij", 5, 4);
        assert_eq!((s.as_str(), cut), ("ghij", true));
        assert_eq!(tail("", 5, 10), (String::new(), false));
    }
}
