import { useEffect, type CSSProperties, type ReactNode } from "react";
import { ZestResponsiveLayout } from "jattac.libs.web.zest-responsive-layout";
import styles from "./SidePane.module.css";

/**
 * The package paints its pane from its own light/dark palette, which ignores the app's chosen
 * theme. Taking the pane background, divider and close colour from the app's theme variables keeps
 * every dialog readable in the default dark theme and in every other built-in or custom theme,
 * instead of light text on the package's white pane (R8, USR-006).
 */
const paneTheme = {
  background: "var(--panel)",
  color: "var(--text)",
  "--zest-pane-bg": "var(--panel)",
  "--zest-pane-divider": "var(--border)",
  "--zest-pane-close": "var(--text)",
  "--zest-pane-close-hover": "var(--accent)",
  "--zest-pane-close-active": "var(--text)",
} as CSSProperties;

export interface SidePaneProps {
  /** Shown in the pane's own header. Dialogs keep their own heading inside the content. */
  title?: ReactNode;
  /** When given, the pane offers a named close control and Escape dismisses it. */
  onClose?: () => void;
  /** Accessible name for the close control. Defaults to "Close". */
  closeLabel?: string;
  children: ReactNode;
}

/**
 * The project's approved responsive side pane (jattac.libs.web.zest-responsive-layout). The
 * package injects its own stylesheet, so no separate CSS import is needed. We leave its own
 * onClose unset: that keeps the desktop overlay purely dimming, exactly like the old dialog
 * backdrop, and avoids its unnamed close button. Our named control and Escape run the caller's
 * cancel action instead, and a pane with no close action (the update dialog while busy) has no
 * way out (R8, A2, A3).
 */
export function SidePane({ title, onClose, closeLabel, children }: SidePaneProps) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className={styles.overlay}>
      <ZestResponsiveLayout
        sidePane={{
          visible: true,
          title,
          style: paneTheme,
          dismissOnEsc: false,
          dismissOnBack: false,
          content: (
            <div className={styles.pane}>
              {onClose && (
                <button type="button" className={styles.close} aria-label={closeLabel ?? "Close"} onClick={onClose}>
                  Close
                </button>
              )}
              {children}
            </div>
          ),
        }}
      />
    </div>
  );
}
