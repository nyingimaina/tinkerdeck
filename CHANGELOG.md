# Changelog

## 1.2.0

**Command line and LLM access**
- `lcmd.exe`: every action from a terminal (`status`, `up`, `down`, `start`, `stop`, `restart`, `logs`, `wait`, `send`, `run`, `git`, `add`, `detect`, `shells`, `doctor`, `quit`, `ui`, `llms`). `--json` on any command; meaningful exit codes. Starts the app hidden when it is not running.
- **MCP server** (`lcmd mcp`, stdio): 14 cheap tools (`lc_status`, `lc_up`, `lc_down`, `lc_start`, `lc_stop`, `lc_restart`, `lc_logs`, `lc_wait`, `lc_send`, `lc_run`, `lc_git`, `lc_add`, `lc_detect`, `lc_shells`). Plain-text output, incremental log cursor, wait-for-pattern readiness.
- **Discoverable by LLM tools:** `lcmd mcp install` registers the server in Claude Code, Claude Desktop, Cursor, Windsurf, VS Code, Gemini CLI and opencode (merged, backed up, never clobbering). The installer does it for you. `README-LLM.md` ships next to the program and is printed by `lcmd llms`; `llms.txt`, `.mcp.json` and `mcp/server.json` ship in the repository.
- The installer always adds `lcmd` to the user PATH.
- Control channel: loopback only, per-launch token.

**Interface**
- Live state: git status, changes, history, branch list and project folders refresh by themselves (`jattac-web-poller`), pause while the window is hidden, and back off when nothing changes. **⟳ Refresh** button and F5 refresh everything now.
- Tabs use `jattac.libs.web.zest-tabs`.
- Any number of consoles under the Console tab, with a VS Code style side list; typing `exit` in the first console starts a fresh shell, extra consoles close themselves.
- Other shells: Windows PowerShell, PowerShell 7, Command Prompt, Git Bash and WSL; a default for the app plus a per-terminal override and a choice per console.
- Collapsible left pane (button or Ctrl+B) that shrinks to a rail and remembers its state.
- Title bar shows the version.

## 1.1.0
- Home screen: favourites, recent apps, running now, one-step "Open folder".
- Git: branch pill, branch switcher (warns about running terminals), commit selected files, commit graph, fetch, pull (fast-forward only), push, sync.
- Console tab: a free shell per app.

## 1.0.0
- Apps made of terminals with real PTYs; start, stop (Ctrl+C then the whole process tree through Windows Job Objects), restart, Start all and Stop all.
- Safe config file (atomic, backup, never overwrites what it cannot parse), light and dark theme, restore-on-launch, single instance, guided setup with project detection, Inno Setup installer with Start Menu shortcut.
