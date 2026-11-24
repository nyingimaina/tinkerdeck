//! Output ring buffer and the per-terminal output bus (BRS 6.5).

pub const RING_CAP: usize = 1024 * 1024;
pub const PENDING_CAP: usize = 4 * 1024 * 1024;

/// Keeps the most recent bytes. When it overflows, the cut moves forward to the
/// next newline so a replay never starts mid-line.
pub struct Ring {
    buf: Vec<u8>,
    cap: usize,
    /// Bytes ever pushed (monotonic, survives `clear`): the cursor space for `since`.
    total: u64,
}

impl Ring {
    pub fn new(cap: usize) -> Ring {
        Ring { buf: Vec::new(), cap, total: 0 }
    }

    pub fn push(&mut self, data: &[u8]) {
        self.total += data.len() as u64;
        self.buf.extend_from_slice(data);
        if self.buf.len() > self.cap {
            let excess = self.buf.len() - self.cap;
            let mut cut = excess;
            // move forward to just after the next newline (bounded search)
            let limit = (excess + 4096).min(self.buf.len());
            if let Some(p) = self.buf[excess..limit].iter().position(|b| *b == b'\n') {
                cut = excess + p + 1;
            } else {
                // no newline nearby: at least do not split a UTF-8 sequence
                while cut < self.buf.len() && (self.buf[cut] & 0xC0) == 0x80 {
                    cut += 1;
                }
            }
            self.buf.drain(..cut);
        }
    }

    pub fn snapshot(&self) -> Vec<u8> {
        self.buf.clone()
    }
    #[cfg(test)]
    pub fn total(&self) -> u64 {
        self.total
    }
    /// Bytes pushed after `cursor`, the new cursor, and whether some were already dropped from the ring.
    pub fn since(&self, cursor: u64) -> (Vec<u8>, u64, bool) {
        let start = self.total - self.buf.len() as u64; // cursor of the first byte still held
        if cursor >= self.total {
            (Vec::new(), self.total, false)
        } else if cursor >= start {
            (self.buf[(cursor - start) as usize..].to_vec(), self.total, false)
        } else {
            (self.buf.clone(), self.total, true)
        }
    }
    pub fn clear(&mut self) {
        self.buf.clear();
    }
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.buf.len()
    }
}

/// Ring buffer + bytes waiting to be sent + whether a UI is attached.
/// Invariant: `pending` is always a suffix-subset of what is in `ring`, so
/// replacing it with a snapshot on attach loses and duplicates nothing.
pub struct OutputBus {
    ring: Ring,
    pending: Vec<u8>,
    pending_cap: usize,
    attached: bool,
}

impl Default for OutputBus {
    fn default() -> Self {
        OutputBus::new(RING_CAP, PENDING_CAP)
    }
}

impl OutputBus {
    pub fn new(ring_cap: usize, pending_cap: usize) -> OutputBus {
        OutputBus { ring: Ring::new(ring_cap), pending: Vec::new(), pending_cap, attached: false }
    }

    pub fn push(&mut self, data: &[u8]) {
        self.ring.push(data);
        if self.attached {
            self.pending.extend_from_slice(data);
            if self.pending.len() > self.pending_cap {
                let drop = self.pending.len() - self.pending_cap;
                self.pending.drain(..drop);
            }
        }
    }

    /// Replace pending with a snapshot of the ring and start streaming.
    pub fn attach(&mut self) {
        self.pending = self.ring.snapshot();
        self.attached = true;
    }
    pub fn detach(&mut self) {
        self.attached = false;
        self.pending.clear();
    }
    pub fn take_pending(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.pending)
    }
    pub fn clear(&mut self) {
        self.ring.clear();
        self.pending.clear();
    }
    #[cfg(test)]
    pub fn snapshot(&self) -> Vec<u8> {
        self.ring.snapshot()
    }
    #[cfg(test)]
    pub fn ring_len(&self) -> usize {
        self.ring.len()
    }
    pub fn since(&self, cursor: u64) -> (Vec<u8>, u64, bool) {
        self.ring.since(cursor)
    }
    pub fn is_attached(&self) -> bool {
        self.attached
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_everything_under_cap() {
        let mut r = Ring::new(100);
        r.push(b"hello ");
        r.push(b"world");
        assert_eq!(r.snapshot(), b"hello world");
    }

    #[test]
    fn overflow_cuts_forward_to_next_newline() {
        let mut r = Ring::new(20);
        for i in 0..10 {
            r.push(format!("line number {i}\n").as_bytes());
        }
        let s = r.snapshot();
        assert!(s.len() <= 20);
        let text = String::from_utf8(s).unwrap();
        assert!(text.starts_with("line number"), "starts mid-line: {text:?}");
        assert!(text.ends_with("9\n"));
    }

    #[test]
    fn overflow_without_newline_does_not_split_utf8() {
        let mut r = Ring::new(10);
        r.push("日本語日本語日本語".as_bytes()); // 27 bytes, 3 per char
        let s = r.snapshot();
        assert!(String::from_utf8(s).is_ok(), "cut must land on a character boundary");
    }

    #[test]
    fn since_returns_only_new_bytes_and_a_monotonic_cursor() {
        let mut r = Ring::new(100);
        r.push(b"hello ");
        let (a, c1, cut) = r.since(0);
        assert_eq!((a.as_slice(), c1, cut), (&b"hello "[..], 6, false));
        r.push(b"world");
        let (b, c2, cut) = r.since(c1);
        assert_eq!((b.as_slice(), c2, cut), (&b"world"[..], 11, false));
        assert_eq!(r.since(c2), (Vec::new(), 11, false));
        assert_eq!(r.since(9999), (Vec::new(), 11, false));
    }

    #[test]
    fn since_reports_truncation_when_the_cursor_fell_out_of_the_ring() {
        let mut r = Ring::new(10);
        r.push(b"0123456789");
        let c = r.total();
        r.push(b"abcdefghij\nklmnopqrst"); // pushes the old bytes out
        let (bytes, total, cut) = r.since(c - 5);
        assert!(cut, "the requested start is gone");
        assert_eq!(total, 31);
        assert!(!bytes.is_empty());
    }

    #[test]
    fn the_cursor_survives_a_clear_so_a_restarted_terminal_is_detected() {
        let mut r = Ring::new(100);
        r.push(b"first run");
        let c = r.total();
        r.clear();
        r.push(b"second");
        let (bytes, total, cut) = r.since(c);
        assert_eq!((bytes.as_slice(), total, cut), (&b"second"[..], 15, false));
    }

    #[test]
    fn bus_streams_nothing_until_attached() {
        let mut b = OutputBus::default();
        b.push(b"before");
        assert!(b.take_pending().is_empty());
    }

    #[test]
    fn attach_replays_ring_then_streams_without_loss_or_duplication() {
        let mut b = OutputBus::default();
        b.push(b"one ");
        b.push(b"two ");
        b.attach();
        b.push(b"three");
        // pending = snapshot("one two ") + "three"
        assert_eq!(b.take_pending(), b"one two three");
        b.push(b" four");
        assert_eq!(b.take_pending(), b" four");
    }

    #[test]
    fn reattach_replays_full_history_again() {
        let mut b = OutputBus::default();
        b.push(b"abc");
        b.attach();
        let _ = b.take_pending();
        b.attach();
        assert_eq!(b.take_pending(), b"abc");
    }

    #[test]
    fn clear_empties_ring_and_pending() {
        let mut b = OutputBus::default();
        b.attach();
        b.push(b"x");
        b.clear();
        assert!(b.take_pending().is_empty());
        assert_eq!(b.ring_len(), 0);
    }

    #[test]
    fn pending_is_capped_oldest_dropped() {
        let mut b = OutputBus::default();
        b.attach();
        let chunk = vec![b'a'; 1024 * 1024];
        for _ in 0..6 {
            b.push(&chunk);
        }
        assert!(b.take_pending().len() <= PENDING_CAP);
    }
}
