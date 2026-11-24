# Lite Commander: guide for LLMs and agents

This file ships next to `lite-commander.exe` and `lcmd.exe`, and `lcmd llms` prints it. It says what the program does and gives the exact parameters of everything. Read it once; the live tool list (`tools/list`) is the authority if they ever differ.

## What it is

Lite Commander runs on the user's Windows PC. It groups a project's terminals (dev servers, databases, shells) into **apps** and lets you start, stop, watch and talk to them, run one-off commands and use git, without opening terminals yourself. Anything an app starts is killed when you stop it, so ports are released.

## Discover everything (in this order)

1. `lcmd help`: every command and option. Add `--json` to any `lcmd` command for raw JSON.
2. `lcmd status`: the user's apps and what is running, one line each. Always start here.
3. `lcmd mcp status`: which LLM tools on this PC are wired to it. `lcmd mcp install` wires every one it finds (Claude Code, Claude Desktop, Cursor, Windsurf, VS Code, Gemini CLI, opencode); `lcmd mcp config` prints a snippet for any other client.
4. MCP clients: `tools/list` is the live description of every tool; the `initialize` reply carries usage instructions.
5. `lcmd doctor`: is the engine reachable? If the app is not running, any `lcmd` command starts it hidden.

## The cheap workflow (use this)

1. `lc_status`: what exists and what is running (reply ends with `rev`).
2. `lc_up` with the app: starts everything in order and **waits until every terminal is ready** or one fails, with the failing terminal's error lines. No polling needed.
3. `lc_run` for tests and builds: the reply is already brief (counts plus only the failures).
4. `lc_logs` with `new: true` to read only what appeared since your last look; add `errors` or `grep` to narrow it.
5. `lc_status` with `since` set to the last `rev`: answers `unchanged` for a few tokens when nothing moved.
6. `lc_down` when finished.

## Tools: exact parameters

Apps and terminals are addressed by **name** (case-insensitive), a unique **prefix**, or id. A terminal can also be `console` or `console:2` (a free shell, not saved). Errors list the valid names.

### `lc_status`
Apps with each terminal's state: `stopped`, `starting`, `running`, `detached`, `stopping`, `exited:CODE`, `failed:REASON`. App state: `running`, `partial`, `stopped`, `failed`.
- `git` (boolean, default false): add branch, dirty, ahead, behind per app.
- `since` (string): the `rev` of a previous reply. Same state returns `unchanged (rev X)`; otherwise the new list and `-- rev X`. The MCP tool always returns a `rev`.

### `lc_up`
Start every terminal of an app in listed order.
- `app` (string, required).
- `wait` (boolean, **default true** over MCP, false on the CLI): return when every terminal is **READY**, or one fails, or the time runs out.
- `timeout_s` (integer, default 120, max 600): how long to wait.
Ready means: its `readyUrl` answers (loopback URLs only, any status below 500), else its output contains its `readyPattern` (case-insensitive text), else it has stayed running for 2 seconds. A one-shot that exited 0 (or a detached container) counts as ready. Reply: `READY in 4.2s: api running, db running`, or `NOT READY after 3.1s: api failed` with each unready terminal's state and, if it printed anything, a brief of its output; `(timed out)` gives the same detail. Set the checks in the edit form (Advanced) or in the config (`readyPattern`, `readyUrl`); `lc_add` fills in `Local:` for Vite and `Now listening on` for ASP.NET.

### `lc_down`
- `app` (string, required). Stops every terminal and returns when they are stopped.

### `lc_start`, `lc_stop`, `lc_restart`
- `app`, `terminal` (strings, required).
- `shell` (string, `lc_start` for a console only): `powershell.exe`, `pwsh.exe`, `cmd.exe`, `gitbash` or `wsl.exe`.
Reply: terminal name and new state. Stop presses Ctrl+C, then kills the whole process tree.

### `lc_logs`
Recent output as plain text (no colour codes, `\r` progress bars collapsed).
- `app`, `terminal` (required).
- `lines` (integer, default 60, max 1000): keep the last N lines (after filtering).
- `since` (integer): the `cursor` of a previous reply; returns only newer output.
- `new` (boolean): same, but the server remembers your last cursor for that terminal in this connection. Prefer this.
- `grep` (string): keep lines containing the text, case-insensitive; `a|b` means a or b.
- `context` (integer, max 20): lines around each `grep`/`errors` hit.
- `errors` (boolean): keep only lines that look like errors (error, fail, exception, panic, fatal, traceback, refused, denied…).
- `dedupe` (boolean): fold lines that differ only in numbers into `line (×N similar)`.
- `brief` (boolean): summarise test and build output (see `lc_run`).
Reply: the text, then `-- cursor N, STATE` (and `, earlier output cut` if lines were dropped).

### `lc_wait`
Block until something happens in one terminal. Use it instead of polling `lc_logs`.
- `app`, `terminal` (required).
- `pattern` (string): wait for this text in the output (ready detection, for example `Local:`).
- `until` (string): `exit` (default without a pattern), `running`, or `match` (default with a pattern).
- `timeout_s` (integer, default 60, max 600).
Reply: `ok: matched (running) 0.7s` plus the last lines; `not ok` with reason `timeout` or `ended-before-match` otherwise.

### `lc_send`
Type into a running terminal (a console, a REPL, a prompt).
- `app`, `terminal`, `text` (required).
- `enter` (boolean, default true): press Enter after the text.
Fails if the terminal is not running.

### `lc_run`
Run one command in the app's folder and get its result. No terminal is kept; a timeout kills the whole process tree.
- `app`, `command` (required). The command text is passed to the shell as is.
- `cwd` (string): subfolder of the app, or an absolute folder.
- `shell` (string): as for `lc_start`. Default is the user's shell setting.
- `timeout_s` (integer, default 60, max 600).
- `format` (`brief` | `full`): **default `brief`** over MCP when no filter is given. `full` returns the tail.
- `lines` (integer, default 100, max 1000): tail length for `full`.
- `grep`, `context`, `errors`, `dedupe` (as for `lc_logs`): any of them replaces the brief default.
Reply: `exit N` (or `timed out`) then the text. **Brief** recognises vitest, jest, dotnet test, cargo test, pytest, go test, tsc, MSBuild and rustc and returns for example `vitest FAILED: 1 failed, 299 passed` plus only the failing tests with their first message lines (max 8, then `… and N more`). Unrecognised output returns the error lines when the exit code is non-zero, otherwise the last lines. A green summary with a non-zero exit shows `(exit N)`.

### `lc_git`
- `app` (required) and `op` (required), one of:
  - `status`: branch, head, ahead/behind, `upstream`, changed `files` (status letter M/A/D/R/?/U, staged).
  - `branches`: current, local, remote-only.
  - `log` (`limit`, default 20, max 200): hash, subject, author, date, refs.
  - `switch` (`branch`): refuses invalid names; git refuses if local changes would be lost.
  - `commit` (`message`, required; `paths` is an array of files, or set `all` to true for every non-conflicted change): commits exactly those files.
  - `fetch`, `pull` (fast-forward only, never merges), `push` (never forces; sets upstream for a new branch), `sync` (pull then push).
Reply: JSON, or a plain message for fetch/pull/push/sync.

### `lc_add`, `lc_detect`
- `path` (string, required): a project folder. `lc_detect` previews; `lc_add` saves the app (name from `name`, default the folder name) with terminals detected from package.json scripts, .NET projects, Docker Compose, Cargo, Go and Python. Adding the same folder twice returns the existing app.

### `lc_shells`
No parameters. Lists installed shells (`id`, `name`).

## Command line equivalents

```
lcmd status [--git] [--since REV]          lcmd up <app> [--wait] [--timeout S]     lcmd down <app>
lcmd start|stop|restart <app> <terminal> [--shell ID]
lcmd logs <app> <terminal> [-n LINES] [--since CURSOR] [--grep A|B] [-C N] [--errors] [--dedupe] [--brief]
lcmd wait <app> <terminal> [--match TEXT] [--for exit|running] [--timeout S]
lcmd send <app> <terminal> <text...> [--no-enter]
lcmd run <app> [--cwd DIR] [--shell ID] [--timeout S] [-n LINES] [--brief] [--grep A|B] [-C N] [--errors] [--dedupe] -- <command...>
lcmd git <app> status | branches | log [-n N] | switch <branch> | commit -m <message> [--all | <paths...>] | fetch | pull | push | sync
lcmd add <path> [--name N]      lcmd detect <path>      lcmd shells
lcmd update [check] | lcmd update apply --yes   (CLI only; never over MCP)
lcmd mcp | mcp install [client...|all] | mcp uninstall | mcp status | mcp config
lcmd llms   lcmd doctor   lcmd ping   lcmd quit   lcmd ui   lcmd version   lcmd help
```
`--json` works everywhere. Exit codes: 0 ok, 1 error (or `up --wait` not ready, `wait` not ok), 2 usage, 124 `run` timed out; `run` otherwise returns the command's own exit code.

## Rules of the road

- **Cost:** prefer `lc_up` (waits for you), `lc_run` brief, `lc_logs` with `new`/`errors`/`grep`, and `lc_status` with `since`. Ask for `format: "full"` or plain `lc_logs` only when the brief answer is not enough.
- Output is plain text, capped to the last lines and 12 000 characters; a footer says when something was cut.
- Errors name the valid choices (apps, terminals, shells). Read them instead of guessing.
- Git never force-pushes and pull is fast-forward only. For a merge or rebase use a console (`lc_start` with `terminal: "console"`, then `lc_send`).
- Everything stays on this PC: the control channel listens on 127.0.0.1 only behind a per-launch token, and ready URLs may only be local.
- Do not put secrets in commands. Ask the user before destructive actions (deleting branches, resetting).
- You cannot update or quit the app over MCP; that is for the user (`lcmd update`).

## Where things are

- Config and log: `%APPDATA%\com.litecommander.app\` (`lite-commander.json`, `lite-commander.log`).
- This guide: `README-LLM.md` next to `lcmd.exe`. Short version: `llms.txt` in the repository.
- Source and requirements: https://github.com/nyingimaina/lite-commander (BRS section 7.12).
