Check each requirement's acceptance criteria against the tests in the build report. For the core, look for tests of the plain functions in `src-tauri/tests/` with real inputs and the failure cases (missing file, bad path, empty input, very large input), asserting the `Err` value as well as the `Ok`. For the window, look for tests that render the screen with `src/api` mocked and assert what a person sees or can do (roles, labels, text, keyboard) in each state the requirement names. For each new command, look for a test of `src/api` that checks the command name and argument names the core expects. Confirm that the app compiled (the startup check) and say so when it did not, or when the window's tools were not installed.

Do not run `tauri build`, `tauri dev` or anything that starts a window or writes an installer; the checks and the tests are the evidence.


## About this existing project

This is an existing Tauri desktop app (a Rust core in src-tauri and a web window) that was not created by DevTeam, built before DevTeam's Tauri standard. Extend it; never recreate or restructure it. Write NEW code to the standard (see your stack guidance): Rust in src-tauri/src/features and src-tauri/src/shared with tests in src-tauri/tests, window code in src/features with its calls into the core only through src/api. Leave old code in its own style, reach it through a small adapter, and change an old file only when a requirement cannot be met otherwise, after tests that freeze what it does today. Read .devteam/adoption/compat.md first: it lists what is old, what the old code already gets wrong (known debt, not yours to fix here) and how the gates judge new work.

- Web app (React, TypeScript): in `.`. Its scripts: dev, build, lint, test, tauri, icons, installer.
- Features live in: `src/features`.
- Shared code lives in: `src/api`.
- Tauri app: in `.`, with 26 Rust file(s) in the core and a window built with react. New code follows the standard; old code keeps its own style. It has its own installer (`installer/tinkerdeck.iss`), left as it is.

Notes from a survey of the project:

# Survey: Tinkerdeck (formerly Lite Commander)

## What it is
- Windows-only desktop app (Tauri 2: Rust core + React 18/TypeScript/Vite UI). Version 2.0.0.
- Users group a project's terminals into "apps"; start/stop them together (whole process tree is killed), with git, a CodeMirror editor, file preview, themes, and self-update.
- Requirements doc: `BRS-app-launcher.md` (code comments cite BRS section numbers). History: `CHANGELOG.md`.

## Main parts
- `src-tauri/src/` (Rust lib `tinkerdeck_lib`, `#![cfg(windows)]`): flat modules, not feature folders. Key ones:
  - `commands.rs`: `#[tauri::command]` functions the UI calls; holds `AppState`.
  - `runtime.rs`, `engine.rs`: run terminals (portable-pty/ConPTY). `job.rs`: Windows job objects for tree kill.
  - `config.rs`, `model.rs`: load/save `tinkerdeck.json` and validate it. `legacy.rs`: copies data from the old `com.litecommander.app` folder.
  - `ipc.rs`: local TCP JSON control channel on 127.0.0.1 with a token in `engine.json`.
  - `git.rs`, `editor.rs`, `editor_cmds.rs`, `themes*.rs`, `update.rs` (signed updates), `ready.rs`, `brief.rs`, `ansi.rs`, `ring.rs` (log buffer).
- `src-tauri/src/bin/tdk/` is a second binary, the `tdk` CLI and MCP server. It calls the running app through `ipc.rs` (`client.rs`, `cli.rs`, `mcp.rs`, `register.rs`).
- `src/` (UI): `App.tsx`; `features/{apps,editor,git,home,...}` (the project map lists 7 features); `api/` (typed wrappers over Tauri `invoke`: `tauri.ts`, `editor.ts`, `themes.ts`); `state/` (hooks like `useLauncher`, `useGit`, `useUpdates`); `themes/`; `styles/global.css`.
- Flow: UI component -> `src/api` -> Tauri command in `commands.rs` -> `Runtime`/`Engine`. `tdk` -> TCP `ipc.rs` -> `Engine`.
- `installer/` (Inno Setup `tinkerdeck.iss`, icons), `scripts/` (installer build, icon rendering, release signing and publishing), `mcp/server.json`, `llms.txt`.

## Build, test, run
- Prereqs: Rust, Node 20+, VS Build Tools (C++), WebView2, Inno Setup 6 (installer only).
- `npm install`
- `npm run tauri dev`: run with hot reload.
- `npm test`: Vitest UI tests (jsdom, setup in `src/test/setup.ts`).
- `npm run lint`: `tsc --noEmit`. `npm run build`: tsc + vite build.
- `cargo test --manifest-path src-tauri/Cargo.toml`: Rust tests, including real process-tree kill tests. They sit inline in `#[cfg(test)]` modules; there is no `src-tauri/tests` folder.
- `npm run icons`: renders PNG/ICO from `installer/icon.svg`.
- `npm run installer`: icons, release build, Inno Setup, and signs `latest.json`.
- Releases: `node scripts/new-update-key.mjs` once, then `scripts/publish-release.ps1`. See the README for the 2.0.0 URL-base caveat (`TD_RELEASE_URL_BASE`).
- CI: not found (no `.github`).

## Conventions
- UI tests sit beside the code (`X.test.tsx`). CSS Modules per component (`X.module.css`). Features go in `src/features/<name>/`. Screens call the core only via `src/api`.
- Rust commands return `Result<_, String>` with a readable, user-facing message (e.g. "That app no longer exists."). `commands.rs` forbids `unwrap`/`expect`. Shared state uses `parking_lot::Mutex`.
- JSON to the UI is camelCase (`serde(rename_all = "camelCase")`).
- Version number must match in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`. `.devteam/pack/tools/check-versions.mjs` checks this.
- DevTeam adoption (`.devteam/adoption/compat.md`) says:
  - New Rust goes in `src-tauri/src/features` and `shared`, with tests in `src-tauri/tests`. Neither folder exists yet.
  - Existing flat modules stay in their own style and are not reformatted.
  - Do not run `cargo fmt` on old files. Format a new file with `rustfmt <file>` only.
  - Clippy is judged against `rust-lint-baseline.txt`.
  - The project map lists "src/shared" and "src-tauri/src/shared" as shared code, but only `src/api` exists today.
- Git commit style: "Tinkerdeck 2.0.0: summary".

## Fragile or surprising
- Rename leftovers: data folder is `com.litecommander.app`; the old `lite-commander.json` and the `lcmd` CLI are still referenced in `legacy.rs` and `register.rs`. Do not delete this migration code. The old data folder is never modified.
- `config.rs` must never overwrite an unparseable config or let a corrupt file replace `.bak`. Saving is locked until the user acknowledges. Keep these rules.
- The update public key is embedded in `update.rs`. If the private key (`~/.lite-commander/update-signing.key`) is lost, installed copies cannot auto-update. The updater accepts both the old and new GitHub repo URL paths.
- Process-tree kill and job objects are Windows-specific; the whole Rust lib is Windows-only (cannot build on other OSes).
- Detached commands (e.g. `docker start`) exit at once, so a stop command is needed. Terminals own their child processes.
- The single-instance handler ignores `--background` launches and forwards "Edit with Tinkerdeck" file args as `editor-open` events.
- The app is not code-signed, so SmartScreen warns on first run.
- The IPC token lives in the user profile; never log it or loosen the 127.0.0.1-only binding.
- `src-tauri/target` and `node_modules` are huge (30k+ files). Exclude them from searches.
- `.devteam/` is untracked. `CLAUDE.md`, a linter config and a formatter config are not found for the UI.
