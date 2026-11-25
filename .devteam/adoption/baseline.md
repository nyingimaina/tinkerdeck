# DevTeam adoption baseline

DevTeam 1.02.294 · 2026-11-25 19:23

## What was found

- Web app (React, TypeScript): in `.`. Its scripts: dev, build, lint, test, tauri, icons, installer.
- Features live in: `src/features`.
- Shared code lives in: `src/api`.
- Tauri app: in `.`, with 26 Rust file(s) in the core and a window built with react. New code follows the standard; old code keeps its own style. It has its own installer (`installer/tinkerdeck.iss`), left as it is.

## Quick checks

- One version number everywhere: **passed**
- Window: type check: **passed**
- Core: formatting: **passed**
- Window: tests, with coverage: **later** (the slower proof, run with: devteam verify)
- Window: build: **later** (the slower proof, run with: devteam verify)
- Core: lints (clippy, warnings are errors): **later** (the slower proof, run with: devteam verify)
- Core: tests: **later** (the slower proof, run with: devteam verify)
- Core: the app compiles: **later** (the slower proof, run with: devteam verify)

## Not set up in this project

Nothing missing that DevTeam looks for.

These stay out of the readiness verdict as **not proven**. The developer is told to add tests where it changes code; nothing is added to your project unless a feature asks for it.

## How to make more checks work

Nothing is stopping a check right now.

## Next:

1. `devteam verify` for the slow proof (full tests, coverage, starting the app).
2. `devteam run "describe the feature you want"`. It is built on its own branch; nothing is merged for you.
3. Changed your mind? `devteam unadopt` removes only the `.devteam` folder.
