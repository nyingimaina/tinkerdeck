import type { FinderController } from "../../themes/useThemeFinder";
import styles from "./Themes.module.css";

const compact = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
};

/** Find and install themes: from the Open VSX registry, or from VS Code extensions already on this PC. */
export function ThemeFinder({ finder: f }: { finder: FinderController }) {
  return (
    <div className={styles.finder}>
      <div className={styles.tabs} role="tablist">
        <button role="tab" aria-selected={f.tab === "online"} onClick={() => f.setTab("online")}>
          Online
        </button>
        <button role="tab" aria-selected={f.tab === "local"} onClick={() => f.setTab("local")}>
          On this PC
        </button>
      </div>

      {f.tab === "online" ? (
        <input
          type="search"
          className={styles.search}
          role="searchbox"
          aria-label="Search themes"
          placeholder="Search themes, e.g. dracula, nord, solarized"
          value={f.query}
          onChange={(e) => f.setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void f.search()}
        />
      ) : (
        <p className={styles.note}>Themes from your VS Code, VS Code Insiders, VSCodium, Cursor and Windsurf extensions.</p>
      )}

      {f.error && (
        <div className={styles.error} role="alert">
          {f.error}
        </div>
      )}
      {f.loading && <p className={styles.note}>Searching…</p>}
      {!f.loading && !f.error && f.entries.length === 0 && (
        <p className={styles.note}>
          {f.tab === "local" ? "No VS Code themes were found on this PC. Try the Online tab." : "Nothing found. Try another search."}
        </p>
      )}

      <ul className={styles.list}>
        {f.entries.map((e) => (
          <li key={e.id} className={styles.card}>
            <div className={styles.cardBody}>
              <div className={styles.cardTitle}>{e.name}</div>
              <div className={styles.meta}>
                {e.publisher}
                {e.downloads > 0 && <> · {compact(e.downloads)} downloads</>}
                {e.version && <> · v{e.version}</>}
              </div>
              {e.description && <div className={styles.desc}>{e.description}</div>}
            </div>
            {f.done.has(e.id) ? (
              <span className={styles.installed}>Installed</span>
            ) : f.installing === e.id ? (
              <button disabled aria-label={`Installing ${e.name}`}>
                Installing…
              </button>
            ) : (
              <button aria-label={`Install ${e.name}`} disabled={f.installing !== null} onClick={() => void f.install(e)}>
                Install
              </button>
            )}
          </li>
        ))}
      </ul>

      {f.tab === "online" && <p className={styles.footnote}>Themes come from the open-vsx.org registry. Only what you type in the search box is sent.</p>}
    </div>
  );
}
