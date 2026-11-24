//! Terminal state machine as a pure function (BRS 6.1).

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TermState {
    Stopped,
    Starting,
    Running,
    Detached,
    Stopping,
    Exited { code: i32 },
    FailedToStart { reason: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    StartRequested,
    Spawned,
    SpawnFailed(String),
    /// The process ended by itself. `has_stop_command` decides Detached.
    ProcessExited { code: i32, has_stop_command: bool },
    StopRequested,
    /// Stop finished (tree gone, stop command done).
    StopCompleted,
}

impl TermState {
    pub fn can_start(&self) -> bool {
        matches!(self, TermState::Stopped | TermState::Exited { .. } | TermState::FailedToStart { .. })
    }
    pub fn can_stop(&self) -> bool {
        matches!(self, TermState::Running | TermState::Detached)
    }
    /// Counts as "up" for the app button and roll-up dot.
    pub fn is_up(&self) -> bool {
        matches!(self, TermState::Running | TermState::Starting | TermState::Detached)
    }
    #[cfg(test)]
    pub fn is_failed(&self) -> bool {
        matches!(self, TermState::FailedToStart { .. })
            || matches!(self, TermState::Exited { code } if *code != 0)
    }
}

/// Returns the next state, or `None` when the event is ignored in this state.
pub fn apply(state: &TermState, event: &Event) -> Option<TermState> {
    use Event::*;
    use TermState::*;
    match (state, event) {
        (s, StartRequested) if s.can_start() => Some(Starting),
        (Starting, Spawned) => Some(Running),
        (Starting, SpawnFailed(r)) => Some(FailedToStart { reason: r.clone() }),
        // A user stop always ends in Stopped, whatever the killed process returned.
        (Stopping, ProcessExited { .. }) => Some(Stopping),
        (Running, ProcessExited { code: 0, has_stop_command: true }) => Some(Detached),
        (Running, ProcessExited { code, .. }) => Some(Exited { code: *code }),
        (Running, StopRequested) | (Detached, StopRequested) => Some(Stopping),
        (Stopping, StopCompleted) => Some(Stopped),
        _ => None,
    }
}

/// Reference implementation of the roll-up rules (the UI computes it for display).
#[cfg(test)]
pub fn rollup(states: &[TermState]) -> &'static str {
    if states.is_empty() {
        return "grey";
    }
    if states.iter().any(|s| s.is_failed()) {
        return "red";
    }
    let up = states.iter().filter(|s| s.is_up()).count();
    if up == states.len() {
        "green"
    } else if up > 0 || states.iter().any(|s| matches!(s, TermState::Stopping)) {
        "amber"
    } else {
        "grey"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use Event::*;
    use TermState::*;

    fn exit(code: i32, stop: bool) -> Event {
        ProcessExited { code, has_stop_command: stop }
    }

    #[test]
    fn start_is_allowed_from_stopped_exited_failed_only() {
        for s in [Stopped, Exited { code: 0 }, Exited { code: 3 }, FailedToStart { reason: "x".into() }] {
            assert_eq!(apply(&s, &StartRequested), Some(Starting), "{s:?}");
        }
        for s in [Starting, Running, Detached, Stopping] {
            assert_eq!(apply(&s, &StartRequested), None, "{s:?} must ignore a second start");
        }
    }

    #[test]
    fn happy_path_start_run_stop() {
        let s = apply(&Stopped, &StartRequested).unwrap();
        let s = apply(&s, &Spawned).unwrap();
        assert_eq!(s, Running);
        let s = apply(&s, &StopRequested).unwrap();
        assert_eq!(s, Stopping);
        assert_eq!(apply(&s, &StopCompleted), Some(Stopped));
    }

    #[test]
    fn spawn_failure_gives_failed_with_reason() {
        assert_eq!(
            apply(&Starting, &SpawnFailed("no folder".into())),
            Some(FailedToStart { reason: "no folder".into() })
        );
    }

    #[test]
    fn exit_codes() {
        assert_eq!(apply(&Running, &exit(0, false)), Some(Exited { code: 0 }));
        assert_eq!(apply(&Running, &exit(3, false)), Some(Exited { code: 3 }));
        assert_eq!(apply(&Running, &exit(3, true)), Some(Exited { code: 3 }));
    }

    #[test]
    fn exit_zero_with_stop_command_is_detached() {
        assert_eq!(apply(&Running, &exit(0, true)), Some(Detached));
    }

    #[test]
    fn user_stop_never_ends_red_even_if_process_exits_nonzero() {
        let s = apply(&Running, &StopRequested).unwrap();
        let s = apply(&s, &exit(1, false)).unwrap();
        assert_eq!(s, Stopping);
        assert_eq!(apply(&s, &StopCompleted), Some(Stopped));
    }

    #[test]
    fn stop_from_detached_goes_through_stopping() {
        assert_eq!(apply(&Detached, &StopRequested), Some(Stopping));
    }

    #[test]
    fn stop_is_ignored_when_not_running() {
        for s in [Stopped, Starting, Stopping, Exited { code: 0 }, FailedToStart { reason: "x".into() }] {
            assert_eq!(apply(&s, &StopRequested), None, "{s:?}");
        }
    }

    #[test]
    fn can_stop_and_up_flags() {
        assert!(Running.can_stop() && Detached.can_stop());
        assert!(!Stopped.can_stop() && !Exited { code: 0 }.can_stop());
        assert!(Running.is_up() && Detached.is_up() && Starting.is_up());
        assert!(!Exited { code: 0 }.is_up());
    }

    #[test]
    fn rollup_rules() {
        assert_eq!(rollup(&[]), "grey");
        assert_eq!(rollup(&[Stopped, Stopped]), "grey");
        assert_eq!(rollup(&[Running, Running]), "green");
        assert_eq!(rollup(&[Detached, Running, Running]), "green");
        assert_eq!(rollup(&[Running, Stopped]), "amber");
        assert_eq!(rollup(&[Running, FailedToStart { reason: "x".into() }]), "red");
        assert_eq!(rollup(&[Exited { code: 2 }, Stopped]), "red");
        assert_eq!(rollup(&[Exited { code: 0 }, Stopped]), "grey");
    }
}
