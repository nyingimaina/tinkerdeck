# Changelog

## 1.7.0

**Preview**
- Files the window can render get a **Raw | Preview** switch: HTML (in an empty sandbox: no scripts, no outside resources), Markdown (sanitised), SVG (shown as an image). Preview follows what you are typing, and switching back keeps your undo history.
- Images (PNG, JPG, GIF, WebP, BMP, ICO, AVIF) and PDFs open straight into a preview. They are never read as text, never edited, and files up to 50 MB are shown.
- The preview code (including the Markdown renderer) is only loaded when you ask for a preview.

**Explorer**
- The installer now also lists Lite Commander under **Open with** for every file type, next to the **Edit with Lite Commander** right-click entry. On Windows 11 the right-click entry is under "Show more options".

## 1.6.0

**Editor: organised by app, with language icons**
- Open editors are listed on the left, grouped under the app whose project folder holds the file (the deepest folder wins). Files with no owning app, and new unsaved documents, live under **Misc**.
- Every editor shows a language icon (for example TypeScript, Python, Rust, JSON, Dockerfile, .gitignore) and the status bar names the language. A document without a recognisable name is detected from what it contains (shebang, JSON, HTML, XML, PHP) and highlighted to match.

## 1.5.0

**Text editor** (Editor button in the header)
- Edit any text file, with highlighting for most languages (CodeMirror 6; each language is loaded only when a file of that type is opened). Tabs, find and replace (Ctrl+F), undo per tab, Ctrl+S / Ctrl+N / Ctrl+O / Ctrl+W, light and dark themes.
- **Nothing you type is lost, even unsaved:** text is snapshotted to disk after a short pause and is back after a restart or crash, like Notepad++. Closing a tab with unsaved text sends it to the bin instead of discarding it.
- **Tidy rotation:** an editor not used for 7 days moves to the **Bin**; after 30 days in the bin it is forgotten. Restore or delete for good from the Bin button.
- **Explorer menu:** right-click any file, then **Edit with Lite Commander** (on Windows 11 under "Show more options"). It opens in the running app, or starts it. Optional in the installer; removed on uninstall.
- Light on resources: the editor is not loaded until you open a file, files over 5 MB are refused, and binary files are not opened. Line endings (CRLF or LF) and encodings (UTF-8, UTF-8 with BOM, UTF-16, Latin-1) are kept exactly as they were; saving is atomic.

**Updates**
- Lite Commander now looks for a new version about once an hour (was once a day) while its window is visible and again whenever you come back to it, so a release is found without restarting.

## 1.4.0

**Cheaper and more useful for LLMs** (documented parameter by parameter in `README-LLM.md`; tests fail if a tool, parameter or flag is undocumented)
- **Brief results:** `lc_run` (MCP default) and `lcmd run --brief` recognise vitest, jest, dotnet test, cargo test, pytest, go test, tsc, MSBuild and rustc and return counts plus only the failures instead of the whole log. Unrecognised output returns the error lines on failure, the last lines on success.
- **Server-side log filters** on `lc_logs`, `lc_run`, `lcmd logs` and `lcmd run`: `grep` (a|b), `context`, `errors`, `dedupe`, `brief`.
- **Ready-aware `up`:** `lc_up` (MCP default) and `lcmd up --wait` return when every terminal is READY, or as soon as one fails (with its error lines), or at the timeout. A terminal is ready when its local `readyUrl` answers, else its output contains its `readyPattern`, else after 2 s of staying up. Both fields are in the edit form (Advanced); Vite (`Local:`) and ASP.NET (`Now listening on`) are filled in on detection. Only loopback URLs are ever requested.
- **Cheap polling:** `lc_status` returns a `rev` and answers `unchanged` for a repeated `since`; `lc_logs` with `new: true` remembers your cursor per terminal for the connection.
- Fuller `lcmd help`, the MCP server instructions and `llms.txt`.

## 1.3.0

**Self-update**
- Lite Commander looks for new versions (about once a day, only while its window is visible) and offers them in a banner: **Update now**, **Later**, **Skip this version**. **Help → Check now** and an on/off switch for the automatic check.
- Updating shows the release notes, warns how many running terminals will be stopped, downloads with a progress bar, verifies, installs silently and reopens the app, which then offers to start the apps that were running.
- Signed: `latest.json` carries an ed25519 signature checked against the public key built into the app; the installer's size and SHA-256 are verified; installers must come from this project's GitHub releases over HTTPS; downgrades are never offered.
- `lcmd update` and `lcmd update apply --yes`.
- Release tooling: `scripts/new-update-key.mjs`, `scripts/sign-release.mjs` (run by `npm run installer`) and `scripts/publish-release.ps1`.

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
