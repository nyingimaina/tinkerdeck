import type { ShellInfo } from "../../api/tauri";
import type { Theme } from "../../themes/types";
import { ThemePicker } from "../themes/ThemePicker";
import { UtilitiesMenu } from "./UtilitiesMenu";
import styles from "./TopBar.module.css";

interface Props {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  shell: string;
  shells: ShellInfo[];
  onShellChange: (id: string) => void;
  themeKind: "light" | "dark";
  onToggleTheme: () => void;
  themes: Theme[];
  activeThemeId: string;
  onSelectTheme: (id: string) => void;
  onRemoveTheme: (id: string) => void;
  onImportTheme: (text: string, fileName: string) => Promise<string | null>;
  onFindThemes: () => void;
  onAddApp: () => void;
  addDisabled?: boolean;
  editorActive: boolean;
  onEditor: () => void;
  onCheckUpdates: () => void;
  updatesBusy: boolean;
  /** The version of an update waiting to be installed, so it stays noticeable while Updates is hidden. */
  updateAvailable?: string | null;
  onRefresh: () => void;
  onHelp: () => void;
}

/**
 * The window's top bar. Controls live in four named groups: Brand (identity and the
 * sidebar toggle), Appearance (Shell, Theme, light/dark), Create (+ App) and Utilities
 * (the advanced Editor, Updates, Refresh and Help commands behind one menu).
 */
export function TopBar({
  sidebarCollapsed,
  onToggleSidebar,
  shell,
  shells,
  onShellChange,
  themeKind,
  onToggleTheme,
  themes,
  activeThemeId,
  onSelectTheme,
  onRemoveTheme,
  onImportTheme,
  onFindThemes,
  onAddApp,
  addDisabled,
  editorActive,
  onEditor,
  onCheckUpdates,
  updatesBusy,
  updateAvailable,
  onRefresh,
  onHelp,
}: Props) {
  const shellKnown = shells.length === 0 || shells.some((s) => s.id === shell);

  return (
    <header className={styles.top}>
      <div className={styles.group} role="group" aria-label="Brand">
        <button
          className={styles.iconBtn}
          onClick={onToggleSidebar}
          aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          title="Toggle sidebar (Ctrl+B)"
        >
          ☰
        </button>
        <img src="/icon.svg" alt="" width="24" height="24" />
        <span className={styles.brand}>Tinkerdeck</span>
      </div>

      <span className={styles.spacer} />

      <div className={styles.group} role="group" aria-label="Appearance">
        <label className={styles.shellPick}>
          <span>Shell</span>
          <select value={shell} onChange={(e) => onShellChange(e.target.value)}>
            {!shellKnown && <option value={shell}>{shell} (not found)</option>}
            {(shells.length > 0 ? shells : [{ id: shell, name: shell, path: "" }]).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <ThemePicker
          themes={themes}
          activeId={activeThemeId}
          onSelect={onSelectTheme}
          onRemove={onRemoveTheme}
          onImportText={onImportTheme}
          onFind={onFindThemes}
        />
        <button onClick={onToggleTheme} aria-label="Toggle theme" title="Toggle light and dark (Ctrl+Alt+T)">
          {themeKind === "dark" ? "☀" : "☾"}
        </button>
      </div>

      <div className={styles.group} role="group" aria-label="Create">
        <button className={styles.add} onClick={onAddApp} disabled={addDisabled}>
          + App
        </button>
      </div>

      <UtilitiesMenu
        editorActive={editorActive}
        onEditor={onEditor}
        onCheckUpdates={onCheckUpdates}
        updatesBusy={updatesBusy}
        updateAvailable={updateAvailable ?? null}
        onRefresh={onRefresh}
        onHelp={onHelp}
      />
    </header>
  );
}
