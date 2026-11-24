//! Windows Job Objects, liveness checks and the taskkill fallback (BRS 6.4).
//!
//! One *launcher job* (kill-on-close) holds the launcher and so every child it
//! ever starts; each terminal additionally gets its own nested job so that one
//! terminal's whole tree can be killed without touching the others.

use std::os::windows::process::CommandExt;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
    TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::Threading::{
    GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SET_QUOTA,
    PROCESS_TERMINATE,
};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const STILL_ACTIVE: u32 = 259;

pub struct Job(HANDLE);

// A job handle is just a kernel handle; it is safe to move and share between threads.
unsafe impl Send for Job {}
unsafe impl Sync for Job {}

impl Job {
    /// Create a job whose members all die when the last handle to it closes.
    pub fn new_kill_on_close() -> Result<Job, String> {
        unsafe {
            let h = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if h.is_null() {
                return Err(format!("CreateJobObject failed: {}", std::io::Error::last_os_error()));
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                h,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if ok == 0 {
                let e = std::io::Error::last_os_error();
                CloseHandle(h);
                return Err(format!("SetInformationJobObject failed: {e}"));
            }
            Ok(Job(h))
        }
    }

    /// Put an existing process (and so its future children) into this job.
    pub fn assign_pid(&self, pid: u32) -> Result<(), String> {
        unsafe {
            let p = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
            if p.is_null() {
                return Err(format!("OpenProcess({pid}) failed: {}", std::io::Error::last_os_error()));
            }
            let ok = AssignProcessToJobObject(self.0, p);
            let err = std::io::Error::last_os_error();
            CloseHandle(p);
            if ok == 0 {
                return Err(format!("AssignProcessToJobObject({pid}) failed: {err}"));
            }
            Ok(())
        }
    }

    /// Kill every process in the job, including descendants started later.
    pub fn terminate(&self) {
        unsafe {
            TerminateJobObject(self.0, 1);
        }
    }
}

impl Drop for Job {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

static LAUNCHER_JOB: OnceLock<Job> = OnceLock::new();

/// Create the launcher-wide kill-on-close job. Only terminals' shells are put in it
/// (never the launcher itself: that breaks WebView2). When the launcher exits, crashes,
/// is killed or the user logs off, Windows closes this handle and kills every terminal.
pub fn init_launcher_job() -> Result<(), String> {
    if LAUNCHER_JOB.get().is_some() {
        return Ok(());
    }
    let job = Job::new_kill_on_close()?;
    let _ = LAUNCHER_JOB.set(job);
    Ok(())
}

/// Put a freshly spawned shell into the launcher job. Call this before assigning it to its own
/// per-terminal job (nested jobs, Windows 8+).
pub fn assign_to_launcher(pid: u32) -> Result<(), String> {
    match LAUNCHER_JOB.get() {
        Some(j) => j.assign_pid(pid),
        None => Err("launcher job is not available".into()),
    }
}

/// True while the process with this id is alive.
pub fn is_alive(pid: u32) -> bool {
    unsafe {
        let p = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if p.is_null() {
            return false;
        }
        let mut code: u32 = 0;
        let ok = GetExitCodeProcess(p, &mut code);
        CloseHandle(p);
        ok != 0 && code == STILL_ACTIVE
    }
}

/// Poll until the process is gone or the timeout passes. Returns true if gone.
pub fn wait_gone(pid: u32, timeout: Duration) -> bool {
    let start = Instant::now();
    loop {
        if !is_alive(pid) {
            return true;
        }
        if start.elapsed() >= timeout {
            return false;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

/// Fallback when no job is available: `taskkill /PID <pid> /T /F`, hidden.
pub fn taskkill_tree(pid: u32) {
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Command, Stdio};

    /// Starts `powershell` which starts a long-lived `ping` child and records its pid.
    fn spawn_tree(pid_file: &std::path::Path, shell_exits: bool) -> std::process::Child {
        let script = format!(
            "$p = Start-Process ping -ArgumentList '-n','120','127.0.0.1' -PassThru -WindowStyle Hidden; \
             $p.Id | Out-File -Encoding ascii '{}'; {}",
            pid_file.display(),
            if shell_exits { "exit 0" } else { "Start-Sleep 120" }
        );
        Command::new("powershell.exe")
            .args(["-NoProfile", "-Command", &script])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn powershell")
    }

    fn read_pid(file: &std::path::Path) -> u32 {
        let start = Instant::now();
        loop {
            if let Ok(t) = std::fs::read_to_string(file) {
                if let Ok(p) = t.trim().parse::<u32>() {
                    return p;
                }
            }
            assert!(start.elapsed() < Duration::from_secs(20), "child pid file never appeared");
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    #[test]
    fn terminating_the_job_kills_parent_and_grandchild() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("pid.txt");
        let job = Job::new_kill_on_close().unwrap();
        let mut child = spawn_tree(&file, false);
        let parent = child.id();
        job.assign_pid(parent).unwrap();
        let grandchild = read_pid(&file);
        assert!(is_alive(parent) && is_alive(grandchild));
        job.terminate();
        assert!(wait_gone(parent, Duration::from_secs(5)), "parent still alive");
        assert!(wait_gone(grandchild, Duration::from_secs(5)), "grandchild still alive");
        let _ = child.wait();
    }

    #[test]
    fn job_also_reaps_leftovers_after_the_shell_exited_by_itself() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("pid.txt");
        let job = Job::new_kill_on_close().unwrap();
        let mut child = spawn_tree(&file, true);
        job.assign_pid(child.id()).unwrap();
        let leftover = read_pid(&file);
        child.wait().unwrap();
        assert!(is_alive(leftover), "the orphan should outlive the shell");
        job.terminate();
        assert!(wait_gone(leftover, Duration::from_secs(5)), "leftover not reaped by the job");
    }

    #[test]
    fn dropping_a_kill_on_close_job_kills_its_members() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("pid.txt");
        let job = Job::new_kill_on_close().unwrap();
        let mut child = spawn_tree(&file, false);
        job.assign_pid(child.id()).unwrap();
        let grandchild = read_pid(&file);
        drop(job);
        assert!(wait_gone(child.id(), Duration::from_secs(5)));
        assert!(wait_gone(grandchild, Duration::from_secs(5)));
        let _ = child.wait();
    }

    #[test]
    fn closing_the_outer_launcher_job_kills_terminals_inside_nested_jobs() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("pid.txt");
        let launcher = Job::new_kill_on_close().unwrap();
        let terminal = Job::new_kill_on_close().unwrap();
        let mut child = spawn_tree(&file, false);
        launcher.assign_pid(child.id()).unwrap(); // outer first
        terminal.assign_pid(child.id()).unwrap(); // then the nested per-terminal job
        let grandchild = read_pid(&file);
        assert!(is_alive(child.id()) && is_alive(grandchild));
        drop(launcher); // the launcher "crashes"
        assert!(wait_gone(child.id(), Duration::from_secs(5)), "shell survived the launcher job closing");
        assert!(wait_gone(grandchild, Duration::from_secs(5)), "grandchild survived the launcher job closing");
        let _ = child.wait();
        drop(terminal);
    }

    #[test]
    fn taskkill_fallback_kills_the_tree() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("pid.txt");
        let mut child = spawn_tree(&file, false);
        let grandchild = read_pid(&file);
        taskkill_tree(child.id());
        assert!(wait_gone(child.id(), Duration::from_secs(5)));
        assert!(wait_gone(grandchild, Duration::from_secs(5)));
        let _ = child.wait();
    }

    #[test]
    fn is_alive_is_false_for_a_dead_pid() {
        let mut c = Command::new("cmd.exe").args(["/C", "exit 0"]).creation_flags(CREATE_NO_WINDOW).spawn().unwrap();
        let pid = c.id();
        c.wait().unwrap();
        assert!(wait_gone(pid, Duration::from_secs(2)));
    }
}
