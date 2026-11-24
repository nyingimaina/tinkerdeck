# BRS: Lite Commander (app launcher), revision 2

Audience: a developer new to Tauri, Rust and Windows process handling. Read the whole document once before writing code. Sections 9 (pitfalls) and 11 (acceptance tests) save the most time.

**Revision 2** folds in the review of revision 1. Main changes: Job Objects are now the primary kill mechanism (6.4); stop tries Ctrl+C first; an optional per-terminal *stop command* and a `Detached` state fix the Docker story (6.1, 6.4); single-instance guard (6.8); CSP corrected for xterm (10); replay race, truncation, backpressure and PTY teardown specified (6.5, 8.3); Rust owns the config (5.3); `running.json` is superseded by the job object (6.7); shell is selectable; per-terminal environment variables; automated tests for the kill logic and the state machine (11.2, 13). The product name is now **Lite Commander** (the "Launchpad" name collides with macOS).

## 1. Purpose

A small desktop app (Windows first) that lets me save **apps**, each made of several **terminals**. A terminal is a name, a working directory and a command. Each terminal runs in its own tab inside the app, grouped under its app, with one click to start or stop it.

It replaces opening VS Code only to use its terminal panel. It is **not** an editor, a git client or a process manager for production. Keep it small.

### 1.1 Example: the Qonsol app

| Terminal | Working directory | Command | Stop command |
|---|---|---|---|
| db | `E:\code\Furaha\Qonsol` | `docker start db` | `docker stop db` |
| api | `E:\code\Furaha\Qonsol\backend\Qonsol.Api` | `dotnet watch run` | |
| frontend | `E:\code\Furaha\Qonsol\frontend` | `npm run dev` | |

Pressing **Start all** on the Qonsol app starts those three, in that order. `db` finishes at once and shows **Detached** (green hollow dot: it exited 0 but has a stop command, so it counts as up). Pressing **Stop** on the frontend tab stops only the frontend, and port 5173 is free a moment later. **Stop all** also runs `docker stop db`.

### 1.2 Why build this rather than use `mprocs` or a `wt` script
`mprocs` (YAML, terminal UI) and a Windows Terminal `wt new-tab` script cover part of this. This app exists for: a GUI editing form, reliable whole-tree stop on Windows (job objects), per-terminal stop commands, and restore-on-launch. If those stop mattering, use `mprocs`.

## 2. Scope

### 2.1 In scope (version 1)
- Add, edit, delete and reorder apps and their terminals.
- Run each terminal's command in a real terminal (so colours, progress bars and typing work), shown in a tab.
- Start, stop and restart one terminal. Start all and stop all for one app.
- A status dot per tab and per app.
- Keep the saved apps between launches.
- Stop everything cleanly when the launcher closes, crashes or is killed.
- A light and dark theme toggle.
- On launch, offer to start the apps that were running last time (15).
- Optional per terminal: stop command, environment variables. Global: choice of shell.

### 2.2 Out of scope (do not build these, even if easy)
Dependencies between terminals, ready-detection, port detection, profiles, merged logs, file editing, git beyond the slice in 7.7 (no merge, rebase, stash, conflict resolution, force push, submodules, LFS: do those in the Console tab, 7.8), search across output, a Windows taskbar jump list (needs COM; later), themes beyond light and dark, auto-update, macOS and Linux builds, accounts or sync, telemetry, system tray. They may come later. Building them now will delay the part that matters: **start and stop must be reliable**.

## 3. Glossary

| Term | Meaning |
|---|---|
| App | A named group of terminals, for example "Qonsol". Has a root folder. |
| Terminal | One saved command with a name and working directory. Shown as a tab. |
| Process tree | The command's process plus every process it started. All of them must stop together. |
| Job Object | A Windows kernel object that groups processes. Terminating or closing it kills every member, including descendants started later. |
| PTY / ConPTY | The pseudo-terminal that makes a program believe it is in a real terminal. ConPTY is Windows' version. |
| Frontend / backend | In this document: the web UI inside the window, and the Rust code. |

## 4. Technology (decided, do not change without asking)

| Part | Choice | Why |
|---|---|---|
| Shell | **Tauri 2** | Small install, native window, uses WebView2. |
| Rust side | `tauri`, `tauri-plugin-dialog`, `tauri-plugin-single-instance`, `portable-pty`, `windows-sys` (Job Objects), `serde`, `serde_json`, `uuid`, `parking_lot`, `anyhow`; dev: `tempfile` | `portable-pty` wraps ConPTY. |
| UI | **React + TypeScript + Vite** | Matches the owner's other projects. |
| Terminal view | **`@xterm/xterm`** with `@xterm/addon-fit` | The standard. |
| Styling | CSS Modules | No inline styles. |
| UI tests | Vitest + React Testing Library | Idiomatic for Vite. |
| Config | One JSON file in the app's config folder | Simple, hand-editable. |
| Installer | Inno Setup 6 | Start Menu shortcut, uninstaller. |

Prerequisites: Rust (`rustup`), Node 20+, Visual Studio Build Tools "Desktop development with C++", WebView2 runtime, Inno Setup 6 (for the installer only).

## 5. Data model

### 5.1 Config file

Location: `app.path().app_config_dir()`, file `lite-commander.json`. Never write next to the executable.

```json
{
  "version": 1,
  "theme": "dark",
  "shell": "powershell.exe",
  "lastRunning": [],
  "apps": [
    {
      "id": "7b1f0c0e-4c0a-4c53-a2b5-0d3f2d6c9a11",
      "name": "Qonsol",
      "root": "E:\\code\\Furaha\\Qonsol",
      "terminals": [
        { "id": "2a8e1f4c-0b57-4d0e-9c1d-3e5f7a9b0c11", "name": "db", "cwd": ".", "command": "docker start db", "stopCommand": "docker stop db", "env": {} },
        { "id": "9d3c7b21-6e44-4f0a-8a52-1c0e2b3d4f55", "name": "api", "cwd": "backend\\Qonsol.Api", "command": "dotnet watch run", "env": { "ASPNETCORE_ENVIRONMENT": "Development" } }
      ]
    }
  ]
}
```

### 5.2 Rules

| Field | Rule |
|---|---|
| `version` | Integer, currently 1. If the file has a higher number, refuse to load it, say so, and refuse to save for the whole session. Never downgrade a newer file. |
| `theme` | `"light"` or `"dark"`. Missing or unknown means `"dark"`. |
| `shell` | `"powershell.exe"` (default) or `"pwsh.exe"`. Missing or unknown means `powershell.exe`. |
| `lastRunning` | App ids that were running when the launcher was last closed with confirmation. Unknown ids are ignored. |
| `id` (app and terminal) | A UUID created by the app. Unique across the file. |
| `name` | Required, 1 to 40 characters after trimming. The UI warns on a duplicate within one app. |
| `root` | Absolute folder path. Must exist when a terminal starts (not when saved). |
| `cwd` | Relative to `root` (`.`, `frontend`) or absolute. Forward slashes are accepted and normalised. |
| `command` | Free text. **May be empty**: opens an interactive shell in that folder. |
| `stopCommand` | Optional free text. Run through the same shell, in the same folder and environment, when the terminal is stopped (6.4). |
| `env` | Optional map of name to value, added to the launcher's environment. No secrets (10). |

### 5.3 Saving and ownership
**Rust owns the config.** The UI never sends the whole file. Commands: `save_apps` replaces only `apps` (validated), `set_theme`, `set_shell`, `set_last_running`. A stale UI can therefore never overwrite theme or `lastRunning`.

Saving the file:
1. Serialize to a string first. If that fails, stop; do not touch the file.
2. Write to `lite-commander.json.tmp` in the same folder.
3. Copy the current file to `.bak`, then rename the temp file over the real one.

Loading, in order:
- File missing: start empty, saving allowed.
- Version higher than supported: start empty, **saving locked permanently**, message says to update the app.
- Invalid JSON or wrong shape: do **not** overwrite it. If `.bak` is valid, load it; otherwise start empty. In both cases the state is **locked**: show "Your saved apps could not be read (reason). A backup is at ...", with **Open folder** and **Continue** buttons. On **Continue** the broken file is first copied to `lite-commander.json.corrupt-<timestamp>` (so the good `.bak` is never replaced by the broken file), then saving is allowed. While locked, every save (including `lastRunning` and theme) is refused.

## 6. Behaviour

### 6.1 Terminal states

```
        start                         process exits itself
Stopped ──────► Starting ► Running ─────────────────────────► Exited(code)
   ▲                           │ stop                   (no stop cmd, or code ≠ 0)
   │                           ▼                                  │
   └──────────────────────  Stopping ──(tree gone)──► Stopped ◄───┘ start again
                                                          ▲
Running ──exits 0, has stopCommand──► Detached ──stop─────┘ (runs stopCommand)

Stopped ──start fails──► FailedToStart(reason)
```

| State | Dot | Meaning |
|---|---|---|
| Stopped | grey | Not running. Output from the last run is still readable. |
| Starting | amber | Spawn in progress (very short). |
| Running | green | The process is alive. |
| Detached | green, hollow | Exited 0 and the terminal has a stop command: it started something that keeps running (Docker). Counts as up. |
| Stopping | amber | Stop requested, waiting for the tree to die. |
| Exited(0) | grey with tick | Finished by itself, success, no stop command. |
| Exited(n≠0) | red | Finished with an error code. |
| FailedToStart | red | Never ran. Reason in plain words. |

Rules that previously were gaps:
- A user-requested stop always ends in **Stopped**, never red, whatever exit code the killed process returned.
- If the process exits on its own while Stopping, the result is Stopped.
- When a shell exits on its own, everything it left behind in its job is killed (the terminal owns everything it starts). A crashed `npm run dev` must not leave `esbuild` holding the port.
- Every state is also shown as text or shape, not only colour (tick, hollow dot, label) for colour-blind users.

The Rust side owns the state, implemented as a **pure function** `(state, event) -> state` so it is unit-testable. The UI only displays what Rust reports.

### 6.2 Actions

| Action | Rule |
|---|---|
| Start | Allowed from Stopped, Exited, FailedToStart. Ignored if Starting, Running, Detached or Stopping. Clears the old output first. |
| Stop | Allowed from Running, Detached, Stopping(ignored). Does nothing if Stopped. |
| Restart | Stop, wait until Stopped, then Start. |
| Start all | Starts every Stopped, Exited or FailedToStart terminal **in listed order**, back to back, no delay, no output waiting. Ignores the others. |
| Stop all | Stops every Running or Detached terminal, in parallel. |
| App button | One button: **Start all** when no terminal is Running, Starting or Detached; **Stop all** otherwise. |

### 6.3 Starting a terminal
1. Work out the folder: `cwd` joined to `root` if relative; normalise slashes. If it does not exist: FailedToStart with `The folder "…" does not exist.`; nothing is spawned.
2. Open a PTY of the tab's current size (default 120 x 30 until the UI reports one).
3. Spawn `<shell> -NoLogo -Command "<command>"`, or `<shell> -NoLogo` for an empty command, in that folder. The command string is passed whole; the launcher appends `; exit $LASTEXITCODE` so the real exit code of a native command is reported (verified by test T3/T4).
4. Environment: the launcher's, plus `TERM=xterm-256color`, plus the terminal's `env`.
5. Right after spawn, assign the child to a new **per-terminal Job Object** (6.4). If assignment fails, log it, continue, and fall back to `taskkill` on stop.
6. Push `ESC c` (terminal reset) into the output stream so the UI clears itself in order with the new output; clear the ring buffer.
7. Set Running and tell the UI. A reader thread forwards output; a waiter thread records the exit code.

Do **not** pass `-NoProfile` by default.

### 6.4 Stopping a terminal (the part most likely to go wrong)

Killing only the shell is not enough: `npm run dev` → `node` → `esbuild`. Version 1 method:

1. **Graceful:** write `0x03` (Ctrl+C) to the PTY. Wait up to **2 seconds** for the process to exit by itself. This lets `dotnet watch`, `docker compose up` and others clean up.
2. **Force:** `TerminateJobObject` on the terminal's job. This kills every descendant, including ones started after the stop request. If the job is unavailable, run `taskkill /PID <pid> /T /F` with `CREATE_NO_WINDOW` (0x08000000) so no console flashes.
3. Wait until the shell is gone (poll up to 5 seconds), close the job, drop the PTY master, join the reader thread. (On Windows, dropping a ConPTY master can block on a pending read. Terminating the job first closes the pipe so the read returns; this order is deliberate and covered by a test.)
4. If the terminal has a **stop command**, run it now, hidden, in the same folder and environment, wait up to 30 seconds, and show its output in the tab. Then set Stopped. Stop on a Detached terminal skips steps 1 to 3 and only runs the stop command.

**Launcher death:** at startup the launcher puts itself into a **launcher job** with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. Every child inherits membership, and each terminal's job is nested inside it (supported since Windows 8). If the launcher exits, crashes, is killed from Task Manager or the user logs off, Windows closes the launcher job and kills every descendant. This is what replaces the `running.json` check of revision 1.

Docker: `docker start db` ends at once and the container keeps running. With a `docker stop db` stop command the terminal is **Detached** and Stop works. Without a stop command it shows Exited(0) and the container is the user's to stop. Describe both in the help text.

### 6.5 Output buffering
- Each terminal keeps the **last 1 MB** of raw output in a ring buffer in Rust. When the buffer overflows, the cut is moved forward to the next newline, so the replay never starts in the middle of a line, a UTF-8 character or an escape sequence.
- Output is raw bytes. Never convert chunks to strings in Rust. Send bytes; xterm.js decodes them.
- **Replay without a race:** each terminal has one small output bus (ring buffer, pending bytes, optional sink) under its own mutex. `attach` takes that mutex once, **replaces** the pending bytes with a snapshot of the ring buffer and installs the sink. Because pending is always a subset of the ring buffer, nothing is lost or duplicated, and nothing is sent while the lock is held.
- **Batching and backpressure:** one flusher thread wakes every 16 ms, takes each bus's pending bytes (under the lock), releases the lock, then sends. Pending is capped at 4 MB per terminal (oldest dropped; the ring buffer still holds history). Nothing is sent to a terminal with no sink.
- UI scrollback: 5000 lines (`scrollback`).

### 6.6 Closing the launcher
- If any terminal is Running or Detached: "N terminals are running. Stop them and quit?" with **Stop and quit** (default) and **Keep running** (cancel). No "quit and leave them running".
- On confirmation: save `lastRunning`, stop all (6.4), wait up to 10 seconds, exit.
- Intercept `WindowEvent::CloseRequested`, call `prevent_close()`, ask the UI, quit only on its answer.

### 6.7 Crash safety
Covered by the launcher job (6.4). Residual risk: the job could not be created or assigned (for example when the launcher itself runs inside a job that forbids breakaway). In that case the app logs it and shows a one-line banner "Crash cleanup is unavailable in this environment".

### 6.8 Single instance
Only one launcher may run. A second launch focuses the existing window and exits.

### 6.9 Launcher log
A rolling log `lite-commander.log` in the config folder: starts, stops, kill method used, job assignment failures, panics (via a panic hook). Never the environment (10).

## 7. User interface

### 7.1 Layout

```
┌───────────────────────────────────────────────────────────────┐
│ ◆ Lite Commander                       [shell ▾] [☾] [ + App ]│
├───────────┬───────────────────────────────────────────────────┤
│ ▼ Qonsol  │  Qonsol            [ ■ Stop all ]  [ ⚙ ]           │
│   ◌ db    │ ┌────┬─────┬──────────┐                            │
│   ● api   │ │◌ db│● api│● frontend│   [ ■ Stop ] [ ↻ Restart ] │
│   ○ front │ └────┴─────┴──────────┘                            │
│ ▶ Pdfer   │  (terminal output fills this area)                 │
└───────────┴───────────────────────────────────────────────────┘
```

- **Left list:** apps, collapsible, each with terminals and dots. Roll-up dot: green if all Running/Detached, amber if some, red if any failed, grey if none.
- **Main area:** the open app's tab strip, then the terminal. Only terminals of the selected app are tabs.
- **Header buttons:** only allowed actions are enabled; the rest are disabled, never hidden (no layout shift).
- Settings (⚙) opens a side pane for editing the app.

### 7.2 Terminal tab behaviour
- One xterm.js instance per terminal, created lazily on first view and then **kept alive**; hidden with CSS. Never destroyed on tab switch.
- When a tab becomes visible: fit, then tell Rust the size. On window resize: same, debounced 100 ms. Never fit a `display: none` element.
- `Ctrl+C` copies when text is selected (and clears the selection), otherwise is sent to the program. `Ctrl+V`, `Ctrl+Shift+C/V` work.
- A stopped or exited terminal shows a banner overlay "Process exited with code N. Press Start to run again." Typing into a non-running terminal does nothing.

### 7.3 Empty and error states (never a blank panel)
| Situation | Message and action |
|---|---|
| No apps | "No apps yet. An app groups the terminals you run together." **Add your first app**. |
| App with no terminals | "This app has no terminals." **Add a terminal**. |
| FailedToStart | Reason in plain words; **Edit terminal**. |
| Config unreadable | 5.3. Banner with the path, **Open folder**, **Continue**. |
| Command not found | Show PowerShell's raw output plus a hint "Is it installed and on your PATH?". |

### 7.4 Editing form (side pane)
App: name, root (Browse…). Terminals: name, working folder (Browse), one-line command, optional stop command, optional environment (`NAME=value` lines). Reorder with up/down buttons. Save disabled until names are valid. Changing a running terminal does not affect the process: "Takes effect the next time you start it." Deleting a running terminal or app stops it first, after confirmation.

### 7.5 Guided setup for novices (pickers instead of typing)
Adding an app must be possible without typing a path or a command.
1. **Choose project folder** is one large button (native folder picker). The app name is filled from the folder name.
2. **Detection** (Rust, `detect.rs`, 3 levels deep, skipping `node_modules`, `.git`, `bin`, `obj`, `target`, `dist`, hidden folders): npm/yarn/pnpm/bun scripts (`dev`, `start`, `serve`… first), .NET web/exe projects (`dotnet watch run`), Docker Compose (`docker compose up` with stop command `docker compose down`), Cargo, Go, Python. Detected terminals are **added automatically** with a plain message ("We found 3 terminals and added them. Remove any you do not need."); a **Detect terminals from this folder** link re-scans without duplicating. If nothing is recognised the message says so and points to templates.
3. **Folder per terminal** is a dropdown of the project's sub-folders (plus "Browse for another folder…").
4. **Command** is an autocomplete: detected scripts for that folder, `docker start <container>` for every container from `docker ps -a`, and common commands. Free typing is still allowed.
5. **Stop command** is filled automatically for `docker start X` and `docker compose up`, follows later edits of the command, and is never overwritten once the user types their own.
6. **Name** has autocomplete (api, frontend, db…); duplicates are numbered automatically.
7. **Add from template** dropdown: plain PowerShell, web front end, .NET API, Docker container (real container name), Docker Compose, Python.
8. Environment variables live under a collapsed *Advanced* section.

### 7.6 Home screen (revision 3)
A **Home** entry at the top of the sidebar, and the screen shown at launch.
- **Running now:** apps with at least one terminal up, with roll-up dot, count of running terminals and **Stop all**.
- **Favourites:** apps with `favourite: true`, as cards (name, folder, roll-up dot, running count, **Start all** / **Stop all**; no branch on cards, to avoid one git call per app), in the user's saved order. Every app row and card has a star toggle.
- **Recent:** up to 8 apps by `lastOpened`, newest first, with a relative time ("2h ago"). Opening or starting an app sets `lastOpened`. Cards whose root folder no longer exists are greyed with "Folder not found".
- **Add:** a card **Open folder…** (pick, detect, save in one step) and the guided **+ App**.
- Config: `favourite` (bool, default false) and `lastOpened` (unix seconds, optional) are additive fields on an app; version stays 1. Favourite order is the order of apps in the file.

### 7.5b Versioning (revision 3)
Semantic versioning, one source of truth set in `package.json`, `src-tauri/Cargo.toml`, `tauri.conf.json` and `installer/lite-commander.iss` together (1.1.0 = home screen, git slice, console). The window title bar always shows the running version ("Lite Commander 1.1.0"), set at startup from the build's own version; it is also written to the log. New features bump the minor number, fixes the patch number.

### 7.7 Git slice (revision 3)
Not a git client: it shows where you are and does the three everyday things. It calls the user's own `git` executable (hidden window, 15 s timeout, off the UI thread), so credentials, hooks and `.gitignore` behave as in their terminal.
- **Branch pill** in the app header: `branch ●` (dot = uncommitted changes), ahead/behind counts when an upstream exists, detached HEAD shown as the short hash. Hidden when the root is not inside a repository. Refreshed when the window gains focus, after any git action and when an app is selected; never on a timer.
- **Switch branch:** dropdown of local branches plus a filter box; remote-only branches are offered as "create tracking branch". If terminals of that app are running, a dialog says so and offers **Stop all, switch, Start all**, **Switch anyway** or **Cancel**. Git's own refusal (for example local changes would be overwritten) is shown in plain words; no auto-stash.
- **Commit:** list of changed files (status letter, checkbox, staged by default), message box, **Commit** (disabled until a message and at least one file are selected). Hook output and errors are shown verbatim. Amend, push and pull are not offered.
- **Fetch, Pull, Push, Sync:** buttons next to the pill.
  - **Fetch** = `git fetch --prune`.
  - **Pull** = `git pull --ff-only` only: it can never create a merge or rewrite history. If the branches diverged the message says a fast-forward is not possible and points to the Console tab.
  - **Push** = `git push`; a branch without upstream is pushed with `-u <remote> <branch>` (remote `origin` if present, else the only/first remote; no remote gives a clear message). Never `--force`. A rejected push shows git's message plus "Pull first, or use the Console tab".
  - **Sync** = Pull (if the branch has an upstream) then Push. Stops at the first failure and says which step failed.
  - Network operations have a 120 s timeout and never prompt on a hidden terminal (`GIT_TERMINAL_PROMPT=0`); Git Credential Manager's own sign-in window still works. If git needs a password or passphrase on the command line the error says: "Run it once in the Console tab to sign in".
  - Pull and Push are disabled while a git operation runs (one per repository at a time).
- **Tree:** read-only graph of the last 200 commits across branches (hash, subject, author, relative date, branch and tag labels). Selecting a commit lists its files.
- Safety: one git operation per repository at a time; no discard, reset or force; paths passed to git after `--`; messages passed via stdin/-F, never through a shell.

### 7.8 Console tab (revision 3)
A built-in interactive shell per app for git and any other command. It is the answer to "everything the app does not do".
- Appears as the last tab of every app, after its saved terminals, with a `>_` marker (tab only; no sidebar row). It is **not saved** in the config and is not part of Start all, Stop all or the roll-up dot.
- Runs the configured shell (`-NoLogo`, interactive) in the app's root folder. It starts the first time its tab is opened, and uses the same engine as any terminal: real PTY, job object, Ctrl+C, resize, replay buffer, Start/Stop/Restart buttons, exit banner.
- Its id is derived from the app id (`console-<appId>`); the same validation rules apply, unknown apps return an error.
- A running Console counts as "running" for the quit confirmation, is stopped by Stop and quit, and is stopped when its app is deleted.
- Git panel has **Open in Console**, which opens the tab (starting it if needed).

### 7.9 Live state by polling (revision 4)
Anything that can change outside the app (a branch checked out in VS Code, files edited, a folder deleted) is kept fresh with `jattac-web-poller` (linear backoff, change detection, `pollNow`, graceful `stop`), wrapped in one hook `usePoller`.
- What is polled: git status of the open app (5 s base, 30 s max), the Changes list while its drawer tab is open (3 s / 20 s), the history while its tab is open (10 s / 60 s), the branch menu while open (5 s / 30 s), project folders on Home (10 s / 60 s).
- Low resource rules: a poller exists only while its view is on screen; all pollers **stop when the window is hidden or minimised** and resume with an immediate poll when it is shown or focused; an unchanged result backs the interval off; the UI re-renders only on a change; git runs with `--no-optional-locks`; a poll never overlaps itself; after 5 consecutive errors the poller stops and the git bar shows "Could not refresh. Retry".
- Terminal states are not polled: Rust pushes them as events.

### 7.10 Tabs, consoles and the collapsible left pane (revision 4)
- Terminal tabs are rendered with `jattac.libs.web.zest-tabs` (animated pill, scrolling with arrows). The last tab is **Console**.
- **Many consoles:** the Console tab holds any number of console instances. A VS Code-style **side list** on the right of the console area shows each instance (status dot, name, shell) with **+** (choose a shell) and **×** (closes it; asks first if something is running). Selecting an entry shows that terminal. Instances live for the session only and are numbered per app ("Console 1", "Console 2"…). A new app starts with one when its Console tab is first opened.
- **Left pane:** collapsible like VS Code. A header button and **Ctrl+B** toggle it; collapsed, it shrinks to a narrow rail with Home, expand, and a green dot for every running app. The choice is remembered. Terminals refit when it changes.

### 7.11 Shells (revision 4)
- Detected shells (Rust `shells.rs`): Windows PowerShell, PowerShell 7 (`pwsh`), Command Prompt, **Git Bash**, **WSL**. Only those found on the machine are offered. The Windows `System32\bash.exe` WSL launcher is not mistaken for Git Bash.
- A global default (header dropdown), an optional **per-terminal shell** in the edit form, and a shell choice for every new console.
- Launch rules per shell (command text is passed whole, never split): PowerShell and pwsh `-NoLogo -Command` with exit-code wrapper; cmd `/C <command>` or interactive; Git Bash `--login -c <command>` or `--login -i` with `CHERE_INVOKING=1` so it starts in the project folder; WSL `--cd <folder> -e bash -lc <command>` or `--cd <folder>`. Stop works the same for all (Ctrl+C, then the job).
- Config: `shell` accepts `powershell.exe`, `pwsh.exe`, `cmd.exe`, `gitbash`, `wsl.exe` (unknown values fall back to PowerShell); a terminal may carry `shell` (same ids, optional).
- Console terminal ids are `console-<appId>:<n>:<shellId>`.

### 7.12 Command line and MCP server for LLMs (revision 4)
**Command-line first:** everything the window does is available to scripts and LLMs through the same engine.
- **Architecture:** the window app owns the engine (terminals, job objects, config). It publishes a control channel: newline-delimited JSON on `127.0.0.1` (random port), requiring a random per-launch token stored in `engine.json` in the user's own config folder. `lcmd.exe` (a small console program installed next to the app, and put on the user's PATH by the installer) connects to it. If the app is not running, `lcmd` starts it hidden (`--background`) and waits up to 25 s; `lcmd quit` ends it, `lcmd ui` opens the window.
- **`lcmd` commands** (add `--json` for raw JSON; exit codes 0 ok, 1 error, 2 usage; `run` returns the command's own exit code, `wait` returns 1 when it did not succeed): `status [--git]`, `up|down <app>`, `start|stop|restart <app> <terminal>`, `logs <app> <terminal> [-n] [--since CURSOR]`, `wait <app> <terminal> [--match TEXT] [--for exit|running] [--timeout S]`, `send`, `run <app> -- <command>`, `git <app> status|branches|log|switch|commit|fetch|pull|push|sync`, `add <path>`, `detect <path>`, `shells`, `doctor`, `ping`, `quit`, `ui`, `mcp`.
- Apps and terminals are named, not numbered: exact id, exact name, or a unique prefix, with the list of choices in every "no match" error. `console`, `console:2` and `--shell` address console instances.
- **MCP server:** `lcmd mcp` speaks MCP (JSON-RPC over stdio, protocol 2024-11-05). 14 tools, `lc_status`, `lc_up`, `lc_down`, `lc_start`, `lc_stop`, `lc_restart`, `lc_logs`, `lc_wait`, `lc_send`, `lc_run`, `lc_git` (one tool, `op` enum), `lc_add`, `lc_detect`, `lc_shells`; the tool list is under 9 KB and each description under 260 characters. Engine failures are tool errors (`isError`), not protocol errors, so a model can read and react to them. Register it in an MCP client with command `lcmd` and argument `mcp`.
- **Discoverability:** MCP has no network broadcast; clients read their own config files. `lcmd mcp install [client...|all]` registers `lcmd mcp` (full path, no PATH needed) in Claude Code (`~/.claude.json`), Claude Desktop, Cursor, Windsurf, VS Code (`servers` shape with `type: stdio`), Gemini CLI and opencode (`~/.config/opencode/opencode.json[c]`, `mcp` key, `type: local`, `command: [exe, "mcp"]`); it only touches clients whose folder exists (explicit ids create the file), merges into existing JSON, writes atomically, copies the original to `<file>.lcmd-backup` once, and refuses a file it cannot parse. `status`, `uninstall` and `config` (paste snippet) complete it. The installer has a task for it (and removes the entries on uninstall). **`README-LLM.md`** is installed next to the executables and printed by `lcmd llms`; it tells an agent how to discover everything (`lcmd help`, `lcmd status`, `lcmd mcp status`, the live MCP tool list) and a test keeps it in step with the tool list. The installer **always** adds its folder to the user's PATH (broadcast with `ChangesEnvironment`), and removes it on uninstall. The repository ships `.mcp.json`, `mcp/server.json` and `llms.txt`, and the server's `initialize` reply carries usage instructions.
- **Why it is cheap for a model** (design rules):
  1. `status` is one call, one short line per app; git is opt-in.
  2. Output is **plain text**: no ANSI codes, `\r` progress bars collapsed, capped at the last 60 lines (max 1000) and 12 000 characters, and says when it cut.
  3. `logs` returns a byte **cursor**; passing it back as `since` returns only new output.
  4. `wait --match` replaces polling: it returns the moment text such as `Local:` appears, the process exits, or the timeout passes, with the last lines and elapsed time.
  5. `run` executes one command with a timeout and returns exit code plus output tail, with no terminal to clean up; timeouts kill the whole process tree.
  6. Safe by construction: no force push, fast-forward pull, branch names validated, token-protected loopback only, everything started is inside the launcher job and dies with it.
- **Further ideas that would help LLMs (not built yet, in priority order):** (a) `ports`: which process holds which listening port, per app, with `free <port>`; (b) `lc_diff` (compact unified diff of the working tree and of one commit); (c) `lc_events` (long-poll for state changes: "tell me when anything exits"); (d) `lc_health` (HTTP GET with expectation, for readiness beyond log text); (e) saved **tasks** per app (named multi-step recipes such as `test`, `reset-db`, exposed as `lc_task`); (f) `lc_env` (read terminal environment keys, never values); (g) a `watch` mode for `logs` that streams until a pattern; (h) per-call `format: "brief"` summaries of test and build output (pass/fail counts, first failure); (i) audit log of every LLM action with an on/off setting; (j) a confirm-first mode for mutating tools.

## 8. Architecture

### 8.1 Folders
```
lite-commander/
  package.json, vite.config.ts, index.html
  src/                     ← React UI
    api/  features/apps/  features/terminals/  state/  styles/
  src-tauri/
    Cargo.toml, tauri.conf.json, capabilities/default.json
    src/
      main.rs lib.rs       ← setup, single instance, close handling
      model.rs             ← App, Terminal, Config
      config.rs            ← load/save (5.3)
      state.rs             ← pure state machine (6.1)
      ring.rs              ← ring buffer + output bus (6.5)
      paths.rs             ← cwd resolution, slash normalisation
      job.rs               ← Job Objects, liveness, taskkill fallback (6.4)
      pty.rs               ← spawn, read loop
      runtime.rs           ← registry, start/stop orchestration
      commands.rs          ← UI-callable functions
  installer/               ← Inno script, icon sources, build script
```

### 8.2 Rust commands the UI may call
```rust
get_config()                                  -> ConfigView  // apps, theme, shell, lastRunning, status(locked/warning)
save_apps(apps)                               -> Result<(), String>
set_theme(theme) / set_shell(shell) / set_last_running(ids) / ack_config()
terminal_states()                             -> Vec<TerminalState>
start_terminal / stop_terminal / restart_terminal (app_id, terminal_id)
start_all / stop_all (app_id)
write_input(terminal_id, data: Vec<u8>) ; resize(terminal_id, cols, rows)
attach(terminal_id, on_output: Channel<InvokeResponseBody>)  // raw bytes
quit_app(stop: bool) ; open_config_folder()
```
Events to the UI: `terminal-state` `{ terminalId, state, exitCode?, reason? }`, `close-requested` `{ running: n }`.

Output uses raw channel bodies (`InvokeResponseBody::Raw`), read as `ArrayBuffer` in the UI. Check names against the installed Tauri version.

Every command that takes an id checks it and returns a clear error. No `unwrap()`/`expect()` reachable from a command.

### 8.3 Concurrency rules
- The registry is one `Mutex<HashMap<TerminalId, Arc<Terminal>>>`. Lock it only to look up or insert; **never hold it** while killing, waiting or sending to the UI. Each `Terminal` has its own small mutexes (state, output bus, runtime handles).
- Each terminal has an operation-in-progress flag; a second Start or Stop while one is running is ignored.
- Reader and waiter threads end when the PTY closes; verified by test.

## 9. Pitfalls
1. Only killing the parent process. Use the job (6.4). Test T6 and the automated tree test.
2. Console window flashing when running `taskkill`. `CREATE_NO_WINDOW`.
3. Converting output to text in Rust.
4. Destroying the xterm instance on tab switch.
5. Forgetting to resize the PTY.
6. `Ctrl+C` copying when nothing is selected.
7. Different PATH when started from the Start menu: run through the shell without `-NoProfile`.
8. Quoting: the command is one string.
9. `cwd` of `.` means the app root.
10. Config loss: never write in place; never overwrite what you could not parse; never let a corrupt main file replace the good `.bak`.
11. Panics: return errors.
12. Double-click race: the in-progress flag.
13. Holding locks while waiting.
14. Zombie threads and handles after Stop (job handle, PTY, threads).
15. Antivirus may flag unsigned apps.
16. ConPTY needs Windows 10 1809+.
17. Path separators: normalise.
18. Output floods: batch at 16 ms with a cap.
19. Docker detaches: use a stop command.
20. **CSP:** xterm injects inline styles; the CSP needs `style-src 'self' 'unsafe-inline'` and `connect-src ipc: http://ipc.localhost`.
21. Windows PowerShell 5.1 vs `pwsh`: the shell is configurable.
22. Don't "improve" the scope: write ideas in `NOTES.md`.

## 10. Security
- UI is local files only. CSP: `default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src ipc: http://ipc.localhost; img-src 'self' data:`.
- Capabilities: window, dialog, own commands. No generic shell plugin.
- Commands never come from the network, a URL or a command-line argument.
- No passwords in commands or `env`; say so in the help text.
- Validate config shape on load; validate names and uniqueness on save.
- Logs never contain the environment.

## 11. Acceptance tests

### 11.1 Manual (on a clean build)
"Port free" = `Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue` returns nothing.

| # | Do this | Expect |
|---|---|---|
| T1 | First launch, no config. | "No apps yet" and **Add your first app**. |
| T2 | App "Test", root `C:\Windows`, terminal `echo hello`. Start. | "hello", grey dot with tick, "exited with code 0". |
| T3 | Command `exit 3`. | Red dot, code 3. |
| T4 | Command `thiscommanddoesnotexist`. | PowerShell error visible, red dot, non-zero code. |
| T5 | Non-existent cwd. | Red, FailedToStart, names the folder, nothing spawned. |
| T6 | `npm run dev` in a Vite project, open the page, Stop. | Port free **and** no project `node.exe` left. |
| T7 | Press Start twice quickly. | One process. |
| T8 | `ping -t localhost`, close the launcher, confirm. | Window closes, no `PING.EXE` left. |
| T9 | Same, choose Keep running. | Launcher stays, ping keeps running. |
| T10 | Kill the launcher from Task Manager while a ping runs. | `PING.EXE` is gone within a second (launcher job). |
| T11 | Empty command. | Interactive shell; `dir` works; `exit` gives Exited 0. |
| T12 | Ctrl+C inside a running dev server. | It stops. |
| T13 | `1..20000 \| % { "line $_" }` | Responsive, scrollback capped. |
| T14 | Resize window, switch tabs. | Correct wrapping everywhere. |
| T15 | `echo "héllo ✓ 日本"` | Correct. |
| T16 | Break the JSON by hand, launch. | Readable error, file not overwritten, `.bak` used; **Continue** keeps a `.corrupt-` copy. |
| T17 | Qonsol app (1.1), **Start all**. | In order; db Detached; button **Stop all**; roll-up green; Stop all runs `docker stop db`. |
| T18 | Add a terminal to a running app. | Running ones undisturbed. |
| T19 | Delete a running terminal. | Confirmation, stopped, removed. |
| T20 | Restart launcher after T17. | Apps listed, all Stopped. |
| T21 | Toggle theme, reopen. | Kept; missing theme shows dark. |
| T22 | Run Qonsol, **Stop and quit**, reopen. | Restore prompt; **No, thanks** starts nothing; **Start them** starts in order. |
| T23 | Start the launcher twice. | Second focuses the first; one process. |
| T24 | Terminal `npm run dev`, Stop. | Console shows Ctrl+C handling first (graceful), then port free. |
| T25 | **+ App**, press **Choose project folder** and pick a Vite project. | Name is filled, the dev terminal is added, Save works without typing anything. |
| T26 | In a terminal row open the **Runs in** dropdown and the **Command** list. | Sub-folders and detected npm scripts are offered. |
| T28 | Star two apps, start one, restart the launcher. | Home lists both as favourites, the started one under Recent (and Running now while up). |
| T29 | Rename a recent app's folder on disk. | Its card is greyed with "Folder not found"; nothing crashes. |
| T30 | Open an app inside a git repo. | Branch pill shows the branch; `●` appears after editing a file. |
| T31 | Switch branch while a dev server runs. | Dialog offers Stop all, switch, Start all; choosing it ends with the new branch checked out and terminals running again. |
| T32 | Commit two of three changed files with a message. | A commit exists with exactly those files; the third stays changed. |
| T33 | Push a new branch, then Sync after a teammate (or second clone) pushed. | First push sets upstream; Sync pulls then pushes; counts return to 0/0. |
| T34 | Make local and remote diverge, press Pull. | Clear "fast-forward not possible" message, history untouched. |
| T35 | Open the Console tab, run `git status`, `dir`, `node -v`; press Ctrl+C on a running command. | Works like any terminal; closing the app asks to stop it. |
| T27 | Choose template **Docker container** with Docker running. | Command is `docker start <real container>` and the stop command is `docker stop <same>`. |

### 11.2 Automated (must run in CI/locally)
- `state.rs`: every transition in 6.1, including user Stop never ending red and Exited-while-Stopping.
- `config.rs`: missing, valid, invalid JSON with and without `.bak`, newer version, locked saves, atomic save and `.bak` rotation, corrupt copy on acknowledge.
- `ring.rs`: overflow cut at newline, snapshot/replace race ordering, pending cap.
- `paths.rs`: relative and absolute cwd, slashes, `..`.
- `job.rs` (Windows integration): spawn parent → child → grandchild, terminate the job, assert all are gone; assert a process that exits leaves nothing behind.
- UI (Vitest): reducer, roll-up dot, app button label, edit-form validation, empty states, confirm dialog.

## 12. Build order (slices)

| Slice | Deliver | Tests |
|---|---|---|
| 1 | Tauri app opens; hard-coded terminal runs `echo hello` in xterm. | T2 |
| 2 | Start, Stop with job + Ctrl+C, state machine, dots, double-click safety. | T3–T7, T12, T24, automated |
| 3 | Config load/save, side-pane editing. | T1, T16, T18–T20 |
| 4 | Left list, tabs, Start all / Stop all, roll-up, stop command, Detached. | T17 |
| 5 | Resize, fit, replay, batching. | T13–T15 |
| 6 | Close handling, restore prompt, single instance. | T8–T10, T22, T23 |
| 7 | Polish, README, icon, Inno installer. | All |

## 13. Definition of done
- Section 11 passes on a clean Windows 11 machine, manual tests run by someone who did not write the code.
- `cargo clippy` clean, `cargo test` passes, `npm run lint`, `npm test` and `npm run build` pass.
- No `unwrap()`/`expect()` in code reachable from a UI command.
- README: build, run, config location, reset, known limitations.
- Installer from Inno Setup with Start Menu shortcut, optional desktop shortcut, and uninstaller.

## 14. Known limitations (state in the README)
- Windows 10 1809 or newer only.
- No dependency ordering; Start all uses the listed order only.
- Detached commands (Docker) need a stop command to be stoppable from the launcher.
- A terminal owns everything it starts: background processes it launches die when it exits or stops.
- Not code-signed: SmartScreen may warn on first run.

## 15. Decisions taken by the owner
1. **Start all** starts terminals back to back, in listed order, with no delay.
2. **Theme** is a toggle saved as `"theme": "light" | "dark"`; default dark.
3. **Restore on launch:** offer to start the apps that were running when last closed (with confirmation, via `lastRunning`). Never start anything without that confirmation.
4. (Rev 2) Product name **Lite Commander**; installer via Inno Setup with a generated SVG-derived icon.
