# Lite Commander: guide for LLMs and agents

You are reading the file that ships next to `lite-commander.exe` and `lcmd.exe`. It tells you what this program does and how to discover and use all of it cheaply. The same text is printed by `lcmd llms`.

## What it is

Lite Commander runs on the user's Windows PC. It groups a project's terminals (dev servers, databases, shells) into **apps** and lets you start, stop, watch and talk to them, run one-off commands, and use git, without opening terminals yourself. Anything an app starts is killed when you stop it, so ports are released.

## How to discover everything (in this order)

1. `lcmd help`: every command with its options (`--json` on any command gives raw JSON).
2. `lcmd status`: the user's apps and what is running, one line each. Always start here.
3. `lcmd mcp status`: which LLM tools on this PC are already wired to it.
4. MCP clients: the tool list (`tools/list`) is the live, authoritative description of every tool; the server's `initialize` reply carries usage instructions.
5. `lcmd doctor`: confirms the app (engine) is reachable. If it is not running, any `lcmd` command starts it hidden.

## Command line (`lcmd`)

`status`, `up|down <app>`, `start|stop|restart <app> <terminal>`, `logs <app> <terminal> [-n N] [--since CURSOR]`, `wait <app> <terminal> --match TEXT [--timeout S]`, `send <app> <terminal> <text>`, `run <app> -- <command>`, `git <app> status|branches|log|switch|commit|fetch|pull|push|sync`, `add <path>`, `detect <path>`, `shells`, `doctor`, `quit`, `ui`, `mcp`, `llms`.
Apps and terminals are addressed by name (or a unique prefix). `console` / `console:2` is a free shell; `--shell` picks powershell.exe, pwsh.exe, cmd.exe, gitbash or wsl.exe.

## MCP server (`lcmd mcp`, stdio)

Register once with every installed LLM client: `lcmd mcp install` (Claude Code, Claude Desktop, Cursor, Windsurf, VS Code, Gemini CLI, opencode). Anything else: `lcmd mcp config` prints a JSON snippet. Tools:

| Tool | Use it to |
|---|---|
| `lc_status` | list apps and terminal states (add `git: true` for branches). Start here |
| `lc_up`, `lc_down` | start or stop every terminal of an app |
| `lc_start`, `lc_stop`, `lc_restart` | control one terminal or a console |
| `lc_logs` | read plain-text output; pass the returned cursor as `since` for only new output |
| `lc_wait` | block until a pattern appears (ready detection), the process exits, or it is running |
| `lc_send` | type into a running terminal |
| `lc_run` | run one command in the app's folder: exit code plus the end of the output |
| `lc_git` | status, branches, log, switch, commit, fetch, pull (fast-forward only), push (never forces), sync |
| `lc_add`, `lc_detect` | add a project folder (terminals auto-detected) or preview detection |
| `lc_shells` | shells installed here |

## Cheap, reliable workflow

1. `lc_status` to see what exists.
2. `lc_up` (or `lc_start` for one terminal).
3. `lc_wait` with a ready pattern (for example `Local:`) instead of polling logs.
4. `lc_logs` with `since` to read only what is new.
5. `lc_run` for tests and builds; check the exit code.
6. `lc_down` when finished, so ports are freed.

## Rules of the road

- Output is plain text with no colour codes, capped to the last lines; a footer says when earlier output was cut.
- Errors name the valid choices (apps, terminals). Read them rather than guessing.
- Git never force-pushes and pull is fast-forward only. For a merge or rebase use a console.
- Everything stays on this PC: the control channel listens on 127.0.0.1 only, behind a per-launch token.
- Do not put secrets in commands. Ask the user for destructive actions (deleting branches, resetting).

## Where things are

- Config and log: `%APPDATA%\com.litecommander.app\` (`lite-commander.json`, `lite-commander.log`).
- This guide: `README-LLM.md` next to `lcmd.exe`.
- Source and requirements: https://github.com/nyingimaina/lite-commander (section 7.12 of the BRS describes this interface).
