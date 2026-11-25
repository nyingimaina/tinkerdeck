# The compatibility layer

This app was built before DevTeam's Tauri standard. Both live together: **new code follows the standard, old code keeps its own dialect, and they meet only through adapters.**

## What is old (left as it is)

- Everything in `src-tauri/src` outside `features/` and `shared/`, and everything in `src` outside `features/`, `shared/` and `api/` that is not already in the standard's shape.
- Old files are changed only when a requirement cannot be met otherwise, in their own style, after tests that freeze their current behaviour (characterization tests). They are never reformatted, reorganised or rewritten as a side effect.

## What is new (the standard)

- New Rust goes in `src-tauri/src/features` and `src-tauri/src/shared`, with its tests in `src-tauri/tests`: plain functions returning `Result`, no `unwrap`/`expect`/`panic!`, and a thin `#[tauri::command]` over them.
- New window code goes in `src/features` and `src/shared`, with its tests beside it. Screens call the core only through `src/api` (one typed function per command), never `invoke` themselves.
- The checks that new code must pass are the pack's rules (TAU-001 to TAU-014). Checks the old code already breaks guard new code only (see the debt below); checks it passes keep guarding the whole app.

## How the gates judge

- **rustfmt**: a file that was already unformatted when DevTeam adopted the app is not judged (`.devteam/adoption/rust-fmt-baseline.txt`); any other file must be formatted. New files are always judged. Do not run `cargo fmt` over old files: it would rewrite code nobody asked to change.
- **clippy**: fails only on messages that are not in the baseline recorded at adoption (`.devteam/adoption/rust-lint-baseline.txt`). A moved old message is not new; a second copy of an old one is. A compile error is never excused.
- **Version**: one number in package.json, src-tauri/Cargo.toml and src-tauri/tauri.conf.json, checked every time.
- A new Rust file is judged from the day it exists. Format a new file with `rustfmt <that file>` only.

## How new code reaches old code

1. Write the interface in the new code's own terms (a trait in `src-tauri/src/features/<feature>/`, or a typed function in `src/api`).
2. Implement it in a small adapter that is the only place calling the old code.
3. Write characterization tests for the adapter that pin down what the old code does today, before relying on it.
4. New features depend on the interface only.
5. Moving an old area to the standard is its own feature, never a side effect of another one.

## The installer

- The app has its own installer: `installer/tinkerdeck.iss`, built by `scripts/build-installer.ps1`. It is left exactly as it is.
- Building, signing and publishing it is the builder's own step: DevTeam never builds it, runs it or installs the tool it needs. A requirement that changes what is installed changes the installer script, and says so.

## Known debt (old code the standard would not allow)

Each check below passes for new code but the old code already breaks it, so it guards new code only. Nothing here is fixed by DevTeam unless a feature asks for it; record anything you learn in `docs/legacy-debt.md`. Only the places are listed, never what is in them.

- **The Rust core does not panic** (`tauri-no-panics`, TAU-006): 18 old file(s).
  - `src-tauri/src/brief.rs`
  - `src-tauri/src/config.rs`
  - `src-tauri/src/detect.rs`
  - `src-tauri/src/editor.rs`
  - `src-tauri/src/engine.rs`
  - `src-tauri/src/gallery.rs`
  - `src-tauri/src/git.rs`
  - `src-tauri/src/ipc.rs`
  - `src-tauri/src/job.rs`
  - `src-tauri/src/legacy.rs`
  - `src-tauri/src/model.rs`
  - `src-tauri/src/ready.rs`
  - … and 6 more
