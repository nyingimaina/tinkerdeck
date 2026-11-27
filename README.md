# Tinkerdeck

**Tinkerdeck is a tinkerer's deck**: a Windows app for the way you really work on a project. Group a project's terminals into an **app**, start and stop them together, keep an eye on git, edit and preview the files around them, and let your LLM drive it all from the command line or MCP.

Save **apps**, each made of several **terminals** (name, folder, command). Each terminal runs in its own tab with one-click start, stop and restart. Stopping kills the whole process tree, so ports are released.

> **Formerly Lite Commander.** Upgrading keeps your apps and settings (copied from the old data folder), and `tdk` replaces `lcmd` (see the [changelog](CHANGELOG.md)). Run `tdk mcp install` once to register the new MCP server and clear the old one.

The full requirements are in [BRS-app-launcher.md](BRS-app-launcher.md).

## Install

Run `installer\output\Tinkerdeck-Setup-2.4.0.exe`. It adds a Start Menu shortcut (and an optional desktop shortcut) and an uninstaller. It installs per user, without admin rights, unless you choose otherwise.

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

Tinkerdeck checks for a new version in the background (about once an hour, only while its window is visible) and shows a banner. **Update now** shows what is new, then downloads the installer, verifies it, stops your running terminals, installs and reopens the app; **Later** and **Skip this version** do what they say. Nothing installs without you pressing the button. **Help → Check now** asks immediately and the checkbox there turns the automatic check off. From a terminal: `tdk update` and `tdk update apply --yes`.

How it stays safe: the version information (`latest.json`) is signed with a private key that never leaves the maintainer's machine, and the app only trusts the matching public key built into it. The installer's size and SHA-256 are checked after download, it must come from this project's GitHub releases over HTTPS, and a version that is not newer is never offered. Your apps and settings are kept (they live in `%APPDATA%`); a restored session offers to start the apps that were running.

### Publishing a release (maintainers)

```powershell
node scripts/new-update-key.mjs     # once: creates ~/.lite-commander/update-signing.key (back it up!) and prints the public key for src-tauri/src/update.rs
npm run installer                   # builds the installer and signs latest.json
git tag -a v2.0.1 -m "Tinkerdeck 1.3.1"; git push origin v1.3.1
powershell -File scripts/publish-release.ps1   # uploads installer, checksum, latest.json and latest.json.sig
```

**The 2.0.0 transition.** The project was renamed (it was `lite-commander`). Copies installed before 2.0.0 only accept installer URLs under the old repository path (GitHub redirects it). So publish 2.0.0 with `TD_RELEASE_URL_BASE=https://github.com/nyingimaina/lite-commander/releases/download/v2.0.0` set when `npm run installer` signs the manifest; Tinkerdeck itself accepts both paths. Later releases can use the new path once no old copies are expected.

**One command for the routine:** `powershell -File scripts/ship.ps1` asks up front whether to bump the version, build the installer, commit, push and release (each on its own), shows the plan, and then performs the chosen ones in that order. `-DryRun` shows the plan without changing anything; `scripts/ship.tests.ps1` tests its helpers. Give action switches (for example `-Bump minor -Build -Release -Yes`) to skip the questions.

Losing the private key means installed copies cannot be updated automatically any more; they would need one manual install of a build that carries a new public key.

## Keyboard

**Ctrl+Shift+P** opens the command palette, which lists every action with its shortcut. Other shortcuts: **Ctrl+B** sidebar, **F5** start all / stop all in the app view (a no-op elsewhere), **Ctrl+Alt+T** switch light/dark; in the editor **Ctrl+S**, **Ctrl+N**, **Ctrl+O** and **Ctrl+W**. App shortcuts also work while a terminal has focus; every other key goes to the shell.

## Command line and LLM tools

The installer always puts `tdk` on your PATH (open a new terminal afterwards). Everything the window does works from a terminal, and LLM tools can drive it through MCP.

```powershell
tdk status                       # one line per app
tdk up Qonsol                    # start everything in order
tdk wait Qonsol frontend --match "Local:" --timeout 60
tdk logs Qonsol api -n 40        # plain text, no colour codes
tdk run Qonsol --brief -- npm test   # one command: 'vitest FAILED: 2 failed, 140 passed' plus only the failures
tdk up Qonsol --wait             # start everything and return when each terminal is READY (or one fails)
tdk logs Qonsol api --errors     # only the error lines (also --grep, -C, --dedupe, --brief, --since)
tdk status --since <rev>         # 'unchanged' when nothing moved
tdk git Qonsol commit -m "fix: thing" --all
tdk help
```

**MCP (discoverable by your LLM tools):** MCP clients find servers in their own config, so Tinkerdeck registers itself there.

```powershell
tdk mcp install        # Claude Code, Claude Desktop, Cursor, Windsurf, VS Code, Gemini CLI, opencode (those found)
tdk llms               # the guide for LLMs (also installed as README-LLM.md next to tdk.exe)
tdk mcp status         # who is registered
tdk mcp uninstall      # remove it again
tdk mcp config         # JSON snippet for any other MCP client
```

The installer offers to do this for you. Existing settings are kept, the original file is backed up once (`*.tdk-backup`), and a file it cannot parse is left untouched. Restart the client afterwards. This repository also ships `.mcp.json` (project scope), `mcp/server.json` (registry manifest) and `llms.txt` (a plain description for agents). If the app is not running, `tdk` starts it hidden.

Safety: the control channel listens on `127.0.0.1` only and needs a per-launch token that lives in your own profile folder.

## Themes

Pick a colour theme from the 🎨 menu in the header. **Tinkerdeck** (graphite, bone, rose and brass, matching the icon) is the default, in a dark and a light version; **Classic** is the earlier blue look. The theme colours the whole window, the terminals and the editor's syntax highlighting.

**VS Code themes:** choose **Import a VS Code theme file…** for a theme `.json` you already have, or **Find more themes…** to search the [open-vsx.org](https://open-vsx.org) registry (only what you type in the search box is sent) and install in one click, or list the themes from VS Code, VS Code Insiders, VSCodium, Cursor and Windsurf extensions already on your PC (**On this PC**). Imported themes are kept in `%APPDATA%\com.tinkerdeck.app\themes.json` and can be removed from the menu.

## Text editor

The **Editor** button in the header opens a light text editor for any file, with highlighting for most languages. Unsaved text is kept automatically (snapshotted as you type) and returns after a restart; closing a tab with unsaved text sends it to the **Bin**. Editors unused for 7 days move to the Bin, and the Bin is emptied after 30 days. The installer can add **Edit with Tinkerdeck** to the Explorer right-click menu for every file (Windows 11: under "Show more options"). HTML, Markdown and SVG files have a **Raw | Preview** switch, and images and PDFs open as previews. The editor code is only loaded when you open a file, and text files over 5 MB are not opened.

## Adding an app (no typing needed)

1. Click **+ App**, then **Choose project folder**. Tinkerdeck looks inside and adds the terminals it recognises (npm scripts, .NET, Docker Compose, Cargo, Go, Python).
2. Adjust anything with the dropdowns: **Runs in** lists the project's folders, **Command** autocompletes from detected scripts and your Docker containers, and **Add from template** covers common cases.
3. Press **Save**, then **Start all**.

## How stop works

1. Ctrl+C is sent to the terminal and the process gets 2 seconds to exit by itself.
2. Then the terminal's **Job Object** is terminated, which kills every descendant, even ones started later.
3. If the terminal has a **stop command** (for example `docker stop db`) it runs afterwards.

The launcher also puts itself in a kill-on-close job: if Tinkerdeck crashes or is killed, Windows ends every terminal it started.

## Where things live

| What | Where |
|---|---|
| Saved apps | `%APPDATA%\com.tinkerdeck.app\tinkerdeck.json` (plus `.bak`) |
| Log | `%APPDATA%\com.tinkerdeck.app\tinkerdeck.log` |

To reset, close the app and delete `tinkerdeck.json`. The uninstaller keeps your saved apps.

If the file cannot be read (for example a stray comma), the app starts from the backup or empty, **does not overwrite your file**, and asks you to press Continue; the broken file is then kept as `tinkerdeck.json.corrupt-<time>`.

## Known limitations

- Windows 10 1809 or newer only.
- No dependency ordering between terminals; **Start all** uses the listed order with no delay.
- Detached commands such as `docker start db` exit immediately. Give the terminal a stop command to make Stop work for them.
- A terminal owns everything it starts: background processes it launches end when it stops or exits.
- Not code-signed, so Windows SmartScreen may warn on first run.
- Do not put passwords in commands or environment values.
