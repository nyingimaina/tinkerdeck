import styles from "./AppFooter.module.css";

interface Props {
  version: string;
  /** The sidebar's expanded/collapsed state, shared with the Ctrl+B toggle (R6). */
  sidebarCollapsed?: boolean;
  /** Toggles the sidebar: the same handler Ctrl+B calls, so the two cannot disagree (R6). */
  onToggleSidebar?: () => void;
}

/**
 * The persistent status strip R2 keeps. It shows the app version, plus one sidebar toggle
 * that shares its state and handler with Ctrl+B so the two stay in step (R6). Hiding
 * optional parts never hides the footer.
 */
export function AppFooter({ version, sidebarCollapsed = false, onToggleSidebar }: Props) {
  return (
    <footer className={styles.footer} role="contentinfo" aria-label="Status">
      <span className={styles.name}>Tinkerdeck</span>
      {onToggleSidebar && (
        <button
          type="button"
          className={styles.toggle}
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
          aria-pressed={sidebarCollapsed}
          title="Toggle sidebar (Ctrl+B)"
        >
          <span className={styles.toggleIcon} aria-hidden="true">
            {sidebarCollapsed ? "»" : "«"}
          </span>
          <span>Sidebar</span>
        </button>
      )}
      <span className={styles.spacer} />
      <span className={styles.version} title="Tinkerdeck version">
        {version ? `v${version}` : "version unknown"}
      </span>
    </footer>
  );
}
