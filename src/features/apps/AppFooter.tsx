import styles from "./AppFooter.module.css";

interface Props {
  version: string;
}

/**
 * The persistent status strip R2 keeps. It shows the app version only: no control here
 * duplicates a primary action, and hiding optional parts never hides it.
 */
export function AppFooter({ version }: Props) {
  return (
    <footer className={styles.footer} role="contentinfo" aria-label="Status">
      <span className={styles.name}>Tinkerdeck</span>
      <span className={styles.spacer} />
      <span className={styles.version} title="Tinkerdeck version">
        {version ? `v${version}` : "version unknown"}
      </span>
    </footer>
  );
}
