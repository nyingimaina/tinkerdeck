# Tinkerdeck UI tidy-up plan (revision 1)

This is the written inventory R1 asks for: every current screen, panel, dialog, footer
element, top-bar control and keyboard shortcut, with the named group each keeps or joins,
whether it shows by default or stays hidden until needed, how it is hidden again, whether
its state survives a restart, and where it is reached from.

The tidy-up changes grouping, default visibility, how open parts are hidden again, what
state is remembered and which shortcuts exist. It does **not** add, remove or redesign a
screen, panel or view. In particular the separate editor view stays a separate view; it is
not embedded in the app view.

Group names used from now on:

| Group | Purpose |
| --- | --- |
| **Brand** | Identity and the one navigation toggle: logo, product name, sidebar toggle. |
| **Appearance** | How the window looks: shell choice, colour theme, light/dark. Always visible, never behind a dialog. |
| **Create** | The one creating action: add an app. Always visible. |
| **Utilities** | Advanced or rarely used commands, hidden in one menu: Editor, Updates, Refresh, Help. |
| **Navigation** | The left app/terminal tree (Sidebar). |
| **App workspace** | The selected app's own header, tabs and terminal surface. |
| **Git** | Branch chip, git actions and the changes/history drawer. |
| **Console** | The list of console shells with their add/switch/close controls. |
| **Editors** | The separate editor view and its tools (EditPane is the app editor, not the text editor). |
| **Status** | The persistent footer strip. |
| **Transient** | Dialogs and banners that exist only while something needs an answer or attention. |

---

## 1. Screens

| # | Screen | Named group | Shows by default | Hidden again by | State remembered | Reached from |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | **Home** (favourites, recent, running now) | Navigation + App workspace | Yes, the launch screen when at least one app exists | Leaving it with a sidebar app row, a Home card or the sidebar **Home** row | No (the app always starts on Home) | Sidebar **Home** row; any Home card; the brand/Home path; `view === "home"` |
| S2 | **App view** (one app: header, git chip, tabs, terminals, consoles) | App workspace | No, opened on demand | **Home** row, another app row, or the sidebar collapse | No (the last open app is `lastRunning` for restarts, not for the view) | Sidebar app row; Home card **Open <app>**; quick add (`Open folder…`) |
| S3 | **Editor** (separate view: open editors, CodeMirror surface, preview, bin, status strip) | Editors | No | The same **Editor** command toggles back to Home, or the Home row | Open documents and their autosaved text are kept by the editor state; the *view choice* is not remembered | **Utilities → Editor**; Explorer "Edit with Tinkerdeck" opens straight into it |

No new screen and no restructured view is introduced (R2). The editor is **not** embedded in
the app view.

## 2. Panels

| # | Panel (file) | Named group | Shows by default | Hidden again by | State remembered | Reached from |
| --- | --- | --- | --- | --- | --- | --- |
| P1 | Sidebar app/terminal tree (`features/apps/Sidebar.tsx`) | Navigation | Yes while an app exists; full width | Brand **☰** toggle or **Ctrl+B** collapses it to a 44px rail; the rail's **Expand sidebar** button reopens it | **Yes** — `localStorage["td.sidebarCollapsed"]` | Always on the left of Home and the app view |
| P2 | App header: app name, Start all / Stop all, Edit (`features/apps/AppHeader.tsx`) | App workspace | Yes in the app view | Leaves with the app view | No | The app view |
| P3 | Git bar (`features/git/GitBar.tsx`) | Git | **No** — collapsed to a branch chip (branch + dirty dot + ahead/behind + refresh) when the app is a repository; a control on the chip expands the full Fetch / Pull / Push / Sync / Changes / History / Console row | The chip control collapses it again; the bar itself leaves with the app view. Outside a repository it renders nothing | No in revision 1 (R9 persists the layout in revision 2); the app view starts from the collapsed chip | The app view; the chip is the single Git home |
| P4 | Tab strip: terminals + **>_ Console** tab (`features/terminals/TabStrip.tsx`) | App workspace | Yes in the app view | Leaves with the app view | Selected tab is not saved | The app view |
| P5 | Terminal surface: one xterm per opened terminal/console (`features/terminals/TerminalHost.tsx`) | App workspace | Yes for the selected tab; other opened terminals stay mounted but hidden so scrollback and process survive | Hidden with CSS when another tab is selected — **never unmounted, so no process is thrown away** | Process lifetime only; not across restarts | Tab strip / sidebar terminal row / console list |
| P6 | Console list (`features/terminals/ConsoleNav.tsx`) | Console | **No** — only when the **>_ Console** tab is selected; the module is code-split (`React.lazy`) so it is not in the initial chunk | Selecting another tab hides it; the first console cannot be closed, extras close from their row | Console list is runtime-only (not saved); the Console tab choice is not saved | **>_ Console** tab; the Git bar's **>_ Console** button |
| P7 | Git drawer: Changes / History (`features/git/GitDrawer.tsx`) | Git | **No** — hidden until **Changes** or **History** is chosen; code-split (`React.lazy`) | Its **Close git panel** button; choosing the other tab keeps it open on that tab | No | Git bar **Changes** / **History** (one entry point pair, one drawer) |
| P8 | App editor pane for creating/editing an app (`features/apps/EditPane.tsx`) | Editors | **No** — only when "+ App" or **Edit <app>** is used; code-split (`React.lazy`) | **Cancel**; **Save** closes it on success | No (form state is per open) | **Create → + App**; App header **⚙ Edit**; EmptyState **Add your first app**; quick-add path also saves |
| P9 | Branch menu popover (`role="dialog"` in `features/git/BranchMenu.tsx`; a popover, not a modal) | Git | **No** — opened by the branch pill | Choosing a branch, **Escape**, or clicking outside | No | Git bar branch chip/pill |
| P10 | Theme finder body (`features/themes/ThemeFinder.tsx`) | Appearance (inside the **Find themes** dialog) | **No** — opened from the theme menu; code-split (`React.lazy`) | The dialog's **Close** | No | **Appearance → Theme → Find more themes…** |
| P11 | Code surface / preview (`features/editor/CodeSurface.tsx`, `PreviewPane.tsx`) | Editors | **No** — already code-split today and only loaded when a file is on screen | Closing the tab / leaving the editor | Autosaved documents stay; the split chunk is cached by the module loader | The editor view |
| P12 | Banner stack (`features/apps/Banner.tsx`) | Transient | Only when a banner condition is true (see §4) | Per-banner action / its own dismissal | No | Top of every screen |

Two entry points, one home (R1 edge case): Git is reachable from both the Git bar and the
Git drawer today. They stay, but with distinct jobs and one home: the **chip** is the Git
home (branch signal + expand control), and the **drawer** is the detail surface opened from
the chip's Changes/History. Nothing is duplicated: the chip does not list files, the drawer
does not act on branches. The Git bar never disappears into the Utilities menu.

## 3. Dialogs

Nine modal dialogs exist today. Every one is mounted only while it is open. The `Dialog` shell
is small and eager; every dialog body (Find themes, the six confirmations, Help, Update) is
code-split so none is in the initial chunk, and every one has a way to close. The six short
confirmations share the palette's on-demand chunk. The branch menu carries a `role="dialog"`
but is a popover rather than a modal, so it is inventoried once, with the panels at P9, and is
not repeated here.

| # | Dialog | Named group | Shows by default | Hidden again by | State remembered | Reached from |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | **Find themes** | Appearance / Transient | No | **Close** | No | Theme menu → **Find more themes…** (body lazy) |
| D2 | **Stop running terminals?** | Transient | No | **Stop and save** or **Cancel** | No | Saving an app edit that removes a running terminal (body lazy) |
| D3 | **Delete <app>?** | Transient | No | **Delete** or **Cancel** | No | EditPane **Delete app** (body lazy) |
| D4 | **Close <console>?** | Transient | No | **Stop and close** or **Cancel** | No | Console list **Close Console n** while it runs (body lazy) |
| D5 | **Switch to <branch>?** | Transient | No | one of its three actions or **Cancel** | No | Git branch change while terminals run (body lazy) |
| D6 | **Start the apps that were running last time?** | Transient | Only after a restart with remembered apps | **Start them** / **No, thanks** | The remembered list is saved; the answer is not | App start (restore prompt; body lazy) |
| D7 | **Quit Tinkerdeck?** | Transient | Only on a close request with running terminals | **Stop and quit** / **Keep running** | No | Window close request (body lazy) |
| D8 | **Update to <version>** | Utilities / Transient | No | **Cancel**, or after install the app restarts | No | Update banner **Update now** (body lazy) |
| D9 | **Help** | Utilities / Transient | No | **Close** | No | **Utilities → Help** (body lazy) |

## 4. Banners (transient, top of the window)

| # | Banner | Named group | Shows by default | Hidden again by | State remembered | Reached from |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | Config locked / could not be read (error) | Transient | Only when the core reports a locked config | **Continue** (unless permanent) or fixing the file and **Open folder** | Config status is the core's; not a UI choice | Launch / reload |
| B2 | Job warning (warn) | Transient | Only when the runtime reports one | It goes when the core clears it | No | Launch / terminal start |
| B3 | Update available (info) | Transient | Only when an update is known; **this is how a hidden Utilities item still gets noticed** | **Later**, **Skip this version**, or install | Skipped version and auto-check are saved in the core settings | Quiet check at launch; manual check |
| B4 | "You have the latest version" (info) | Transient | Only after a manual check found nothing | **Dismiss** (also clears after 12s) | No | **Utilities → Updates** |
| B5 | Manual check failed (error) | Transient | Only after a failed manual check | **Dismiss** | No | **Utilities → Updates** |
| B6 | Load/save error (error) | Transient | Only on a launcher error | **Dismiss** | No | Any command failure |

## 5. Top-bar controls (the eleven interactive header entries today)

The logo and the product name are decorative/identity only (Brand), not controls. The count
of eleven includes the theme menu's two entries, because they are top-bar-reachable
controls today.

| # | Control (today) | Named group afterwards | Default visibility | Hidden again by | State remembered | Reached from |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **☰** sidebar toggle | **Brand** | Visible | Same button / **Ctrl+B** toggles back; rail has **Expand sidebar** | **Yes** (`td.sidebarCollapsed`) | Always top-left |
| 2 | **Shell** select | **Appearance** | Visible (never behind a dialog) | Not a transient; change saves immediately | **Yes** — saved by the core (`config.shell`) | Always in Appearance |
| 3 | **✎ Editor** | **Utilities** | Hidden until **Utilities** is opened | Choosing it closes the menu and toggles the editor view | No | **Utilities** |
| 4 | **⬆ Updates** (check now) | **Utilities** | Hidden until **Utilities** is opened | Choosing it closes the menu; result appears as B3/B4/B5 | No | **Utilities**; also **Help → Check now** and the always-visible update banner |
| 5 | **⟳ Refresh** | **Utilities** | Hidden until **Utilities** is opened | Choosing it closes the menu | No | **Utilities**, **F5**, and the Git bar **⟳** |
| 6 | **? Help** | **Utilities** | Hidden until **Utilities** is opened | Choosing it closes the menu and opens D9 | No | **Utilities** |
| 7 | **🎨 Theme** menu trigger | **Appearance** | Visible (never behind a dialog) | *n/a* (a menu trigger) | The chosen theme is saved by the core | Always in Appearance |
| 8 | **Find more themes…** | **Appearance** (inside the theme menu) | Hidden until the theme menu opens | Choosing it closes the menu and opens D1 | No | Theme menu |
| 9 | **Import a VS Code theme file…** | **Appearance** (inside the theme menu) | Hidden until the theme menu opens | Choosing it closes the menu; success closes it too | Imported themes are saved by the core | Theme menu |
| 10 | **☀ / ☾** light-dark toggle | **Appearance** | Visible | *n/a* (a toggle) | **Yes** — saved as `config.theme` | Appearance; **Ctrl+Alt+T** |
| 11 | **+ App** | **Create** | Visible | Opens P8; **Cancel** closes it | No | Always in Create; EmptyState **Add your first app** |

Primary actions stay visible with no hidden area in front of them (R3): open an app (Home
cards / sidebar), run a command (tab strip and the **>_ Console** tab), open Git (the visible
branch chip), toggle the sidebar (Brand ☰ and **Ctrl+B**). Shell and Theme never move behind
a dialog. The grouped header wraps (`flex-wrap`) and the groups keep `min-width: 0`, so if the
window is too narrow the groups drop to a second row instead of overlapping or clipping; on
screen at the 900×560 minimum they still fitted on one row with nothing clipped (§10).

R1 edge case — a control row that mixed concerns: today Shell, Theme and Updates sit in one
row. Afterwards **Shell** and **Theme** are in **Appearance**, and **Updates** is in
**Utilities**. Nothing stays in a mixed row.

## 6. Keyboard shortcuts

| Shortcut | Action | Owner / where handled | Named group | Also reachable by | Notes |
| --- | --- | --- | --- | --- | --- |
| **Ctrl+B** | Toggle sidebar | Window handler in `App.tsx`; forwarded by the terminal | Brand / Navigation | Brand **☰** | Existing; unchanged. Works when the terminal or editor has focus. |
| **F5** | Refresh everything | Window handler in `App.tsx`; forwarded by the terminal | Utilities | **Utilities → Refresh**; Git bar **⟳** | Existing; unchanged. |
| **Ctrl+S** | Save the active editor file | `EditorView.tsx` window handler | Editors | Editor toolbar **Save** | Existing; must keep working while the editor is focused. |
| **Ctrl+Shift+S** | Save as | `EditorView.tsx` | Editors | **Save as…** | Existing. |
| **Ctrl+N** | New editor file | `EditorView.tsx` | Editors | **New** | Existing. |
| **Ctrl+O** | Open files | `EditorView.tsx` | Editors | **Open…** | Existing; **conflict** — the app must not take Ctrl+O. |
| **Ctrl+W** | Close the active tab | `EditorView.tsx` | Editors | Tab **×** | Existing; app must not take Ctrl+W. |
| **Ctrl+Shift+P** | Open the command palette | New shared shortcut registry + window handler, forwarded by the terminal | Utilities | **Shortcut-only in revision 1** | New. Recorded as a shortcut-first function so it does not disappear from the plan. |
| **Ctrl+Alt+T** | Switch light/dark theme | New shared shortcut registry + window handler, forwarded by the terminal | Appearance | **☀ / ☾** toggle | New. Chosen over a Ctrl+Shift+T because the editor does not use it and it matches "theme". |
| **Ctrl+C / Ctrl+Shift+C / Ctrl+V** | Terminal copy/paste | `TerminalHost.tsx` xterm handler | App workspace | — | Existing; Ctrl+C goes to the program when nothing is selected, Ctrl+Shift+C or a selection copies, Ctrl+V pastes. These must **not** be taken by the app. |
| **Escape** | Close the open menu / popover / theme finder search focus | ThemePicker, Utilities menu, BranchMenu, Console menu | Transient | Menu triggers | Keeps "hidden again" one key away. |

Conflict record (R4 edge case): the editor already owns **Ctrl+O** (open), **Ctrl+S**,
**Ctrl+Shift+S**, **Ctrl+N** and **Ctrl+W**. The tidy-up does not add any app-level Ctrl+O
(and does not add Ctrl+W or Ctrl+N). The palette is bound to **Ctrl+Shift+P**, which the
editor does not use, and the theme toggle to **Ctrl+Alt+T**. Ctrl+B and F5 are unchanged.

Pass-through (R4): the terminal's `attachCustomKeyEventHandler` forwards only the app
shortcuts (Ctrl+B, F5, Ctrl+Shift+P, Ctrl+Alt+T) to the window and lets every other key go
to the shell. The editor's own handler runs on the window and `preventDefault`s its keys, so
its keys are never stolen. Both use one shared predicate in `src/shared/shortcuts.ts` so the
two lists cannot drift.

## 7. What loads lazily and what is always on screen (A2 / R5)

| Part | Today | After revision 1 |
| --- | --- | --- |
| `CodeSurface` (CodeMirror) | Lazy | Lazy (unchanged) |
| `PreviewPane` | Lazy | Lazy (unchanged) |
| App shell, TopBar, Sidebar, HomeScreen, AppHeader, TabStrip, Banner, Dialog | Eager | Eager (small, needed before the user acts) |
| `GitBar` (branch chip) | Eager, always expanded | Eager but the full tools are collapsed behind the chip; still only fetched while an app view is open |
| `GitDrawer` | Eager module, rendered only when opened | **Lazy** module, rendered only when opened |
| `ConsoleNav` | Eager module, rendered only when the Console tab is open | **Lazy** module, rendered only when the Console tab is open |
| `EditPane` | Eager module, rendered only when creating/editing | **Lazy** module |
| `ThemeFinder` body | Eager module inside the Find themes dialog | **Lazy** body |
| `CommandPalette` | does not exist | **Lazy**, only mounted while open |
| `Help` dialog body | Inline in the App module | **Lazy**, shares the palette's on-demand chunk |
| Confirmation dialog bodies (D2–D7) | Inline in the App module | **Lazy**, share the palette's on-demand chunk |
| `UpdateBanner`, `UpdateDialog`, `UpdateSettingsBlock` | Eager in `UpdateUI.tsx` | **Lazy** module; the banner loads only when an update is known, the dialog and settings block only when opened |

Initial view therefore carries none of the git tools, the console list, the app editor, the
theme finder, the palette, the Help body, the confirmation dialog bodies or the update
banner/dialog bodies: every modal dialog is mounted only while it is open, and a dialog's body
loads the on-demand chunk the first time any dialog opens. Hiding a part is never done by
unmounting a running terminal: only the CSS hides it (P5).

## 8. Package decisions (R1 acceptance: in-house or a maintained package, and why)

No npm package is added in revision 1. Each new building block is built in-house from the
patterns already in the app:

| Block | Decision | Why |
| --- | --- | --- |
| Grouped top bar | In-house (native buttons + CSS module) | Pure layout; no behaviour to buy. Matches the existing header. |
| Utilities menu | In-house, mirroring `ThemePicker`'s existing menu pattern (Escape + click-outside cleanup) | Reuses a pattern already tested against React 18.3 and the Tauri WebView2; avoids a new dependency for one menu. |
| Footer | In-house | A version strip; nothing to buy. |
| Command palette | In-house filtered fixed list | Small, fixed action list; no search index. A package (cmdk) is evaluated for R10 in revision 2, not adopted blind. |
| Shortcut registry | In-house key matcher | The rules are four shortcuts with explicit pass-through; a hook library buys nothing here. |

Candidates to verify later (R10, revision 2): `jattac.libs.web.overflow-menu`,
`jattac.libs.web.zest-button`, `cmdk`, `react-hotkeys-hook`, Radix — checked against React
18.3, the Tauri WebView2 and this app's CSS before adoption. The jattac packages already
installed stay installed; this revision does not remove them.

## 9. Gaps found and what happens to them (R1 edge cases)

| Gap today | Fix / entry in this revision |
| --- | --- |
| The Git tools (Fetch/Pull/Push/Sync/Changes/History/Console) are always on screen in an app view | Collapsed behind the branch chip; expanded with the chip control; the drawer keeps its own close button. |
| No footer exists at all although R2/R6 keep one | A slim persistent **Status** footer is added showing the app version only; the sidebar toggle it will carry lands in revision 2. |
| An update notice is now inside the Utilities menu, which could hide it | The UpdateBanner (B3) is never hidden and the Utilities trigger gains an "update available" badge, so an available update stays noticeable. |
| Functions reachable only by shortcut are easy to forget | Only the new command palette is shortcut-first (Ctrl+Shift+P); it is recorded above and the palette itself lists every action with its shortcut. No existing function is shortcut-only. |
| A part that opens with no way back | Found none open today: every dialog has a close/cancel, the drawer has Close, the theme menu closes on Escape/outside, the sidebar has the rail's Expand button. The new Utilities menu gets the same Escape/outside behaviour, and every item closes it on choose. |

## 10. Running-app verification (A2)

This was checked against the running window, not from the source alone. The built window
bundle — the same `dist/` assets the Tauri window embeds — was rendered and driven during this
run at the app's default 1280×800 size and at its smallest supported 900×560 size. Each state
the plan talks about was exercised (open an app, expand and collapse the git tools, open
Utilities and Help, press Ctrl+B) and what actually appeared on screen is recorded below.
Screenshots of every state listed were captured during this run; the CSS modules in the last
column are the ones behind what was seen.

| Screen | What was on screen | CSS checked | Result |
| --- | --- | --- | --- |
| Home | Four separate top-bar groups, left to right: **Brand** (☰, logo, "Tinkerdeck"), then **Appearance** (Shell "PowerShell 7", theme palette, ☀), **Create** (+ App in the accent colour) and **Utilities** (…). The advanced Editor / Check for updates / Refresh / Help are **not** in the bar; choosing **Utilities** listed exactly Editor, Check for updates, Refresh (F5) and Help. Sidebar expanded on the left (Home, Demo, Tools); Home shows Favourites / Recent / Add / All apps; the footer strip reads "Tinkerdeck" on the left and "v2.0.0" on the right. | `App.module.css`, `TopBar.module.css`, `UtilitiesMenu.module.css`, `Sidebar.module.css`, `HomeScreen.module.css`, `AppFooter.module.css` | Matches R3 |
| App view | The git bar was one collapsed chip — "⎇ main ●", "↑2 ↓0", a ⟳ refresh and a ▾ toggle — with no Fetch/Pull/Push/Sync/Changes/History/Console until the ▾ toggle was chosen; choosing it showed the full tools and the toggle turned to ▴ (hide again). App header "Demo" with Start all / ⚙; tab strip api · web · >_ Console with Start/Stop/Restart; the terminal area; footer "v2.0.0". | `App.module.css`, `Git.module.css`, `TerminalHost.module.css`, `AppHeader.module.css` | Matches R5 |
| Editor view | Opened from **Utilities → Editor**; same grouped top bar; New / Open… / Save / Save as… toolbar, Bin (0), the empty-state message and the "v2.0.0" footer. The separate editor view stayed separate and was not embedded in an app view. | `EditorView.module.css`, `App.module.css`, `AppFooter.module.css` | Matches R2 |
| Utilities → Help | Choosing **Utilities → Help** opened the Help dialog over Home: a scrollable body, an Updates section (Version 2.0.0, "Check for updates automatically", Check now) and a **Close** button. Nothing of that body was in the window before the dialog was opened. | `CommandPalette.module.css`, `Dialog.module.css` | Matches R4 / R5 |
| Home at the 900×560 minimum | The same four groups stayed on one row with nothing overlapping or clipped: Shell, the theme palette, ☀, + App and the Utilities "…" all remained reachable. | `TopBar.module.css` | Matches R3 |
| Ctrl+B | Pressing Ctrl+B collapsed the sidebar to a narrow rail showing » (Expand sidebar), Home, D and T rows with their dots, and the Home content reflowed to the left; the rail's » button is the way back. | `Sidebar.module.css`, `App.module.css` | Matches R4 |

Lazy/eager is recorded in §7. The Ctrl+B key was pressed in the running window and reached the
app (the sidebar collapsed), so the pass-through described in §6 is confirmed on screen. Every
row above was seen during this run; no part of the check is left to a later manual pass.
