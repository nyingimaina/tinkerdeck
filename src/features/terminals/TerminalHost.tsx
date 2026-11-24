import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { api, attachTerminal } from "../../api/tauri";
import { isUp, type TermState } from "../../state/model";
import styles from "./TerminalHost.module.css";

interface Props {
  appId: string;
  terminalId: string;
  visible: boolean;
  state: TermState;
  theme: "light" | "dark";
  onEdit: () => void;
}

const DARK = { background: "#070b18", foreground: "#d7defa", cursor: "#38bdf8", selectionBackground: "#2a3a78" };
const LIGHT = { background: "#ffffff", foreground: "#1b2140", cursor: "#0b6bcb", selectionBackground: "#bcd3f7" };

/**
 * One xterm instance per terminal, created once and kept alive (hidden with CSS)
 * so scrollback and cursor state survive tab switches.
 */
export function TerminalHost({ appId, terminalId, visible, state, theme, onEdit }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  const doFit = () => {
    const el = box.current;
    const t = term.current;
    const f = fit.current;
    if (!el || !t || !f || !visibleRef.current || el.offsetParent === null) return; // never fit a hidden element
    try {
      f.fit();
      void api.resize(terminalId, t.cols, t.rows).catch(() => {});
    } catch {
      /* element not laid out yet */
    }
  };

  useEffect(() => {
    if (!box.current) return;
    const t = new Terminal({
      fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
      fontSize: 13,
      scrollback: 5000,
      cursorBlink: true,
      allowProposedApi: true,
      theme: theme === "dark" ? DARK : LIGHT,
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(box.current);
    term.current = t;
    fit.current = f;

    const enc = new TextEncoder();
    const paste = () => navigator.clipboard.readText().then((s) => t.paste(s)).catch(() => {});
    const copy = () => {
      const sel = t.getSelection();
      if (sel) {
        void navigator.clipboard.writeText(sel);
        t.clearSelection();
      }
    };
    t.attachCustomKeyEventHandler((e) => {
      // app shortcuts (F5 refresh, Ctrl+B sidebar) belong to the app, not to the shell
      if (e.type === "keydown" && (e.key === "F5" || (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "b"))) return false;
      if (e.type !== "keydown" || !e.ctrlKey) return true;
      const k = e.key.toLowerCase();
      if (k === "c") {
        if (e.shiftKey || t.hasSelection()) {
          copy();
          return false;
        }
        return true; // nothing selected: Ctrl+C goes to the program
      }
      if (k === "v") {
        void paste();
        return false;
      }
      return true;
    });
    t.onData((d) => void api.writeInput(terminalId, Array.from(enc.encode(d))).catch(() => {}));
    t.onBinary((d) => void api.writeInput(terminalId, Array.from(d, (c) => c.charCodeAt(0))).catch(() => {}));

    void attachTerminal(appId, terminalId, (bytes) => t.write(bytes)).catch(() => {});

    let timer: number | undefined;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(doFit, 100);
    });
    ro.observe(box.current);
    requestAnimationFrame(doFit);

    return () => {
      window.clearTimeout(timer);
      ro.disconnect();
      t.dispose();
      term.current = null;
      fit.current = null;
    };
    // created once per terminal id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, terminalId]);

  useEffect(() => {
    if (term.current) term.current.options.theme = theme === "dark" ? DARK : LIGHT;
  }, [theme]);

  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => {
        doFit();
        term.current?.focus();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const up = isUp(state);
  return (
    <div className={`${styles.host} ${visible ? "" : styles.hidden}`} data-terminal={terminalId}>
      <div ref={box} className={`${styles.term} ${up ? "" : styles.dim}`} />
      {!up && (
        <div className={styles.banner} role="status">
          {state.kind === "exited" && <span>Process exited with code {state.code}. Press Start to run again.</span>}
          {state.kind === "failedToStart" && (
            <>
              <span>{state.reason}</span>
              <button onClick={onEdit}>Edit terminal</button>
            </>
          )}
          {state.kind === "stopped" && <span>Not running. Press Start to run it.</span>}
          {state.kind === "stopping" && <span>Stopping…</span>}
        </div>
      )}
    </div>
  );
}
