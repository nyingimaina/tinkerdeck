# Lite Commander

Save **apps**, each made of several **terminals** (name, folder, command). Each terminal runs in its own tab with one-click start, stop and restart. Stopping kills the whole process tree, so ports are released.

The full requirements are in [BRS-app-launcher.md](BRS-app-launcher.md).

## Install

Run `installer\output\LiteCommander-Setup-1.6.0.exe`. It adds a Start Menu shortcut (and an optional desktop shortcut) and an uninstaller. It installs per user, without admin rights, unless you choose otherwise.

Requires Windows 10 version 1809 or newer (ConPTY) and the WebView2 runtime (already present on Windows 11).

## Build from source

Prerequisites: Rust (`rustup`), Node 20+, Visual Studio Build Tools with "Desktop development with C++", WebView2, and Inno Setup 6 for the installer.

```powershell
npm install
npm run tauri dev        # run with hot reload
npm test                 # UI tests (Vitest)
cargo test --manifest-path src-tauri/Cargo.toml   # Rust tests, including real process-tree kill tests
npm run installer        # icons + release build + Inno Setup installer
```

The icon is drawn in `installer/icon.svg` (and `icon-small.svg` for 16 to 32 px). `npm run icons` renders the PNGs and the multi-size `.ico` from them.

## Updates

Lite Commander checks for a new version in the background (about once an hour, only while its window is visible) and shows a banner. **Update now** shows what is new, then downloads the installer, verifies it, stops your running terminals, installs and reopens the app; **Later** and **Skip this version** do what they say. Nothing installs without you pressing the button. **Help → Check now** asks immediately and the checkbox there turns the automatic check off. From a terminal: `lcmd update` and `lcmd update apply --yes`.

How it stays safe: the version information (`latest.json`) is signed with a private key that never leaves the maintainer's machine, and the app only trusts the matching public key built into it. The installer's size and SHA-256 are checked after download, it must come from this project's GitHub releases over HTTPS, and a version that is not newer is never offered. Your apps and settings are kept (they live in `%APPDATA%`); a restored session offers to start the apps that were running.

### Publishing a release (maintainers)

```powershell
node scripts/new-update-key.mjs     # once: creates ~/.lite-commander/update-signing.key (back it up!) and prints the public key for src-tauri/src/update.rs
npm run installer                   # builds the installer and signs latest.json
git tag -a v1.3.1 -m "Lite Commander 1.3.1"; git push origin v1.3.1
powershell -File scripts/publish-release.ps1   # uploads installer, checksum, latest.json and latest.json.sig
```

Losing the private key means installed copies cannot be updated automatically any more; they would need one manual install of a build that carries a new public key.

## Command line and LLM tools

The installer always puts `lcmd` on your PATH (open a new terminal afterwards). Everything the window does works from a terminal, and LLM tools can drive it through MCP.

```powershell
lcmd status                       # one line per app
lcmd up Qonsol                    # start everything in order
lcmd wait Qonsol frontend --match "Local:" --timeout 60
lcmd logs Qonsol api -n 40        # plain text, no colour codes
lcmd run Qonsol --brief -- npm test   # one command: 'vitest FAILED: 2 failed, 140 passed' plus only the failures
lcmd up Qonsol --wait             # start everything and return when each terminal is READY (or one fails)
lcmd logs Qonsol api --errors     # only the error lines (also --grep, -C, --dedupe, --brief, --since)
lcmd status --since <rev>         # 'unchanged' when nothing moved
lcmd git Qonsol commit -m "fix: thing" --all
lcmd help
```

**MCP (discoverable by your LLM tools):** MCP clients find servers in their own config, so Lite Commander registers itself there.

```powershell
lcmd mcp install        # Claude Code, Claude Desktop, Cursor, Windsurf, VS Code, Gemini CLI, opencode (those found)
lcmd llms               # the guide for LLMs (also installed as README-LLM.md next to lcmd.exe)
lcmd mcp status         # who is registered
lcmd mcp uninstall      # remove it again
lcmd mcp config         # JSON snippet for any other MCP client
```

The installer offers to do this for you. Existing settings are kept, the original file is backed up once (`*.lcmd-backup`), and a file it cannot parse is left untouched. Restart the client afterwards. This repository also ships `.mcp.json` (project scope), `mcp/server.json` (registry manifest) and `llms.txt` (a plain description for agents). If the app is not running, `lcmd` starts it hidden.

Safety: the control channel listens on `127.0.0.1` only and needs a per-launch token that lives in your own profile folder.

## Text editor

The **Editor** button in the header opens a light text editor for any file, with highlighting for most languages. Unsaved text is kept automatically (snapshotted as you type) and returns after a restart; closing a tab with unsaved text sends it to the **Bin**. Editors unused for 7 days move to the Bin, and the Bin is emptied after 30 days. The installer can add **Edit with Lite Commander** to the Explorer right-click menu for every file (Windows 11: under "Show more options"). The editor code is only loaded when you open a file, and files over 5 MB or binary files are not opened.

## Adding an app (no typing needed)

1. Click **+ App**, then **Choose project folder**. Lite Commander looks inside and adds the terminals it recognises (npm scripts, .NET, Docker Compose, Cargo, Go, Python).
2. Adjust anything with the dropdowns: **Runs in** lists the project's folders, **Command** autocompletes from detected scripts and your Docker containers, and **Add from template** covers common cases.
3. Press **Save**, then **Start all**.

## How stop works

1. Ctrl+C is sent to the terminal and the process gets 2 seconds to exit by itself.
2. Then the terminal's **Job Object** is terminated, which kills every descendant, even ones started later.
3. If the terminal has a **stop command** (for example `docker stop db`) it runs afterwards.

The launcher also puts itself in a kill-on-close job: if Lite Commander crashes or is killed, Windows ends every terminal it started.

## Where things live

| What | Where |
|---|---|
| Saved apps | `%APPDATA%\com.litecommander.app\lite-commander.json` (plus `.bak`) |
| Log | `%APPDATA%\com.litecommander.app\lite-commander.log` |

To reset, close the app and delete `lite-commander.json`. The uninstaller keeps your saved apps.

If the file cannot be read (for example a stray comma), the app starts from the backup or empty, **does not overwrite your file**, and asks you to press Continue; the broken file is then kept as `lite-commander.json.corrupt-<time>`.

## Known limitations

- Windows 10 1809 or newer only.
- No dependency ordering between terminals; **Start all** uses the listed order with no delay.
- Detached commands such as `docker start db` exit immediately. Give the terminal a stop command to make Stop work for them.
- A terminal owns everything it starts: background processes it launches end when it stops or exits.
- Not code-signed, so Windows SmartScreen may warn on first run.
- Do not put passwords in commands or environment values.
