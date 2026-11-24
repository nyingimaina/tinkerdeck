import { useEffect, useRef, useState } from "react";
import { api, pickFolder } from "../../api/tauri";
import {
  TEMPLATES,
  TERMINAL_NAMES,
  commandOptions,
  deriveStopCommand,
  folderOptions,
  formatEnv,
  joinPath,
  nameFromPath,
  newTerminal,
  normalizeSlashes,
  parseEnv,
  suggestionToTerminal,
  uniqueName,
  validateApp,
  type AppDef,
  type Suggestion,
  type TerminalDef,
} from "../../state/model";
import styles from "./EditPane.module.css";

export interface Helpers {
  listShells: () => Promise<{ id: string; name: string }[]>;
  pick: (defaultPath?: string) => Promise<string | null>;
  detectProject: (root: string) => Promise<Suggestion[]>;
  suggestCommands: (folder: string) => Promise<Suggestion[]>;
  listSubfolders: (root: string) => Promise<string[]>;
  dockerContainers: () => Promise<string[]>;
}

const defaultHelpers: Helpers = {
  listShells: () => api.listShells(),
  pick: pickFolder,
  detectProject: (r) => api.detectProject(r),
  suggestCommands: (f) => api.suggestCommands(f),
  listSubfolders: (r) => api.listSubfolders(r),
  dockerContainers: () => api.dockerContainers(),
};

interface Props {
  initial: AppDef;
  isNew: boolean;
  runningTerminalIds: string[];
  onSave: (app: AppDef) => void;
  onCancel: () => void;
  onDelete?: () => void;
  /** Injected in tests; defaults to the Tauri-backed helpers. */
  helpers?: Partial<Helpers>;
}

interface Row extends TerminalDef {
  envText: string;
  /** Last values we filled in ourselves, so we can keep them in sync until the user edits them. */
  stopAuto?: string;
}

const BROWSE = "__browse__";
const toRow = (t: TerminalDef): Row => ({ ...t, envText: formatEnv(t.env) });

export function EditPane({ initial, isNew, runningTerminalIds, onSave, onCancel, onDelete, helpers }: Props) {
  const h: Helpers = { ...defaultHelpers, ...helpers };
  const hRef = useRef(h);
  hRef.current = h;

  const [name, setName] = useState(initial.name);
  const [root, setRoot] = useState(initial.root);
  const [rows, setRows] = useState<Row[]>(initial.terminals.map(toRow));
  const [subfolders, setSubfolders] = useState<string[]>([]);
  const [shells, setShells] = useState<{ id: string; name: string }[]>([]);
  const [containers, setContainers] = useState<string[]>([]);
  const [suggest, setSuggest] = useState<Record<string, Suggestion[]>>({});
  const [detecting, setDetecting] = useState(false);
  const [detectMsg, setDetectMsg] = useState<string | null>(null);
  const nameTouched = useRef(initial.name !== "");

  // Installed shells, once, for the per-terminal shell dropdown.
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => hRef.current.listShells())
      .then((s) => live && setShells(s))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // Docker container names, once, for the autocomplete lists.
  useEffect(() => {
    let live = true;
    hRef.current.dockerContainers().then((c) => live && setContainers(c)).catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // Sub-folders of the project root feed the folder dropdowns.
  useEffect(() => {
    if (!root.trim()) {
      setSubfolders([]);
      return;
    }
    let live = true;
    const t = window.setTimeout(() => {
      hRef.current.listSubfolders(normalizeSlashes(root)).then((s) => live && setSubfolders(s)).catch(() => {});
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [root]);

  // Per-row command suggestions for that row's folder.
  const folderKey = rows.map((r) => `${r.id}|${r.cwd}`).join(";") + "@" + root;
  useEffect(() => {
    if (!root.trim()) return;
    let live = true;
    const t = window.setTimeout(() => {
      for (const r of rows) {
        hRef.current
          .suggestCommands(joinPath(root, r.cwd))
          .then((s) => live && setSuggest((m) => ({ ...m, [r.id]: s })))
          .catch(() => {});
      }
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderKey]);

  const draft = (): AppDef => ({
    favourite: initial.favourite,
    lastOpened: initial.lastOpened,
    id: initial.id,
    name: name.trim(),
    root: normalizeSlashes(root),
    terminals: rows.map(({ envText, stopAuto: _a, ...t }) => ({
      ...t,
      name: t.name.trim(),
      cwd: normalizeSlashes(t.cwd) || ".",
      stopCommand: t.stopCommand?.trim() ? t.stopCommand : undefined,
      shell: t.shell || undefined,
      env: parseEnv(envText),
    })),
  });
  const validation = validateApp({ ...initial, name, terminals: rows });
  const rootMissing = root.trim() === "";

  const update = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: -1 | 1) =>
    setRows((r) => {
      const j = i + d;
      if (j < 0 || j >= r.length) return r;
      const c = [...r];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });

  /** Detect terminals for the root and add the ones not already listed. */
  const detect = async (rootPath: string, announce: boolean) => {
    setDetecting(true);
    try {
      const found = await h.detectProject(rootPath);
      setRows((cur) => {
        const have = new Set(cur.map((r) => `${r.cwd}|${r.command}`));
        const names = cur.map((r) => r.name);
        const add: Row[] = [];
        for (const s of found) {
          if (have.has(`${s.cwd}|${s.command}`)) continue;
          const t = suggestionToTerminal(s);
          t.name = uniqueName(t.name, [...names, ...add.map((a) => a.name)]);
          add.push({ ...toRow(t), stopAuto: t.stopCommand });
        }
        if (announce) {
          setDetectMsg(
            add.length
              ? `We found ${add.length} terminal${add.length === 1 ? "" : "s"} and added ${add.length === 1 ? "it" : "them"}. Remove any you do not need.`
              : found.length
                ? "Everything we found is already in the list."
                : "We could not recognise a project here. Use “Add a terminal” to pick one.",
          );
        }
        return [...cur, ...add];
      });
    } catch {
      setDetectMsg("Could not scan that folder.");
    } finally {
      setDetecting(false);
    }
  };

  const chooseRoot = async () => {
    const p = await h.pick(root || undefined);
    if (!p) return;
    setRoot(p);
    if (!nameTouched.current || !name.trim()) {
      setName(nameFromPath(p));
      nameTouched.current = false;
    }
    if (rows.length === 0) await detect(p, true);
  };

  const addFromTemplate = (id: string) => {
    const tpl = TEMPLATES.find((t) => t.id === id);
    if (!tpl) return;
    const made = tpl.make(containers);
    const t = { ...newTerminal(), ...made };
    t.name = uniqueName(t.name, rows.map((r) => r.name));
    setRows((r) => [...r, { ...toRow(t), stopAuto: t.stopCommand }]);
  };

  /** Command typed or picked: fill a matching stop command and name while they are still ours. */
  const onCommand = (i: number, value: string) => {
    const row = rows[i];
    const patch: Partial<Row> = { command: value };
    const known = (suggest[row.id] ?? []).find((s) => s.command === value);
    const derived = known?.stopCommand ?? deriveStopCommand(value);
    const current = row.stopCommand ?? "";
    if (!current.trim() || current === row.stopAuto) {
      patch.stopCommand = derived ?? "";
      patch.stopAuto = derived ?? undefined;
    }
    update(i, patch);
  };

  const heroStep = isNew && rootMissing && rows.length === 0;

  return (
    <aside className={styles.pane} aria-label={isNew ? "Add app" : "Edit app"}>
      <div className={styles.head}>
        <h3>{isNew ? "Add app" : "Edit app"}</h3>
        <button onClick={onCancel} aria-label="Close">
          ✕
        </button>
      </div>

      <div className={styles.scroll}>
        {heroStep && (
          <div className={styles.hero}>
            <p className={styles.heroTitle}>1. Choose your project folder</p>
            <p className={styles.hint}>
              We will look inside it and suggest the terminals to run (npm scripts, .NET, Docker…). Nothing to type.
            </p>
            <button className={styles.bigBtn} onClick={chooseRoot}>
              📁 Choose project folder…
            </button>
          </div>
        )}

        <label className={styles.field}>
          <span>App name</span>
          <input
            value={name}
            onChange={(e) => {
              nameTouched.current = true;
              setName(e.target.value);
            }}
            maxLength={80}
            placeholder="Qonsol"
          />
        </label>

        <div className={styles.field}>
          <span>Project folder</span>
          <div className={styles.inline}>
            <input
              aria-label="Root folder"
              value={root}
              onChange={(e) => setRoot(e.target.value)}
              onBlur={() => {
                if (isNew && rows.length === 0 && root.trim()) void detect(normalizeSlashes(root), true);
              }}
              placeholder="Click Browse to choose a folder"
            />
            <button onClick={chooseRoot}>Browse…</button>
          </div>
          {!rootMissing && (
            <button className={styles.link} disabled={detecting} onClick={() => detect(normalizeSlashes(root), true)}>
              🔍 {detecting ? "Looking…" : "Detect terminals from this folder"}
            </button>
          )}
          {detectMsg && <p className={styles.found}>{detectMsg}</p>}
        </div>

        <h4 className={styles.sub}>Terminals</h4>
        {rows.length === 0 && <p className={styles.hint}>This app has no terminals yet.</p>}

        {rows.map((t, i) => {
          const options = commandOptions(suggest[t.id] ?? [], containers);
          const stopOption = deriveStopCommand(t.command);
          return (
            <fieldset key={t.id} className={styles.row} aria-label={`Terminal ${i + 1}`}>
              <div className={styles.rowHead}>
                <input
                  aria-label={`Terminal ${i + 1} name`}
                  value={t.name}
                  list={`names-${t.id}`}
                  onChange={(e) => update(i, { name: e.target.value })}
                  placeholder="Name, e.g. api"
                />
                <datalist id={`names-${t.id}`}>
                  {TERMINAL_NAMES.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
                <button aria-label={`Move terminal ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button
                  aria-label={`Move terminal ${i + 1} down`}
                  disabled={i === rows.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
                <button aria-label={`Remove terminal ${i + 1}`} onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>
                  🗑
                </button>
              </div>

              <label className={styles.mini}>
                <span>Runs in</span>
                <select
                  aria-label={`Terminal ${i + 1} folder`}
                  value={t.cwd || "."}
                  onChange={async (e) => {
                    if (e.target.value !== BROWSE) return update(i, { cwd: e.target.value });
                    const p = await h.pick(root || undefined);
                    if (p) update(i, { cwd: p });
                  }}
                >
                  {folderOptions(subfolders, t.cwd).map((f) => (
                    <option key={f} value={f}>
                      {f === "." ? ". (project folder)" : f}
                    </option>
                  ))}
                  <option value={BROWSE}>Browse for another folder…</option>
                </select>
              </label>

              <label className={styles.mini}>
                <span>Command</span>
                <input
                  aria-label={`Terminal ${i + 1} command`}
                  value={t.command}
                  list={`cmds-${t.id}`}
                  onChange={(e) => onCommand(i, e.target.value)}
                  placeholder="Pick or type, e.g. npm run dev (empty = plain shell)"
                  className={styles.mono}
                />
                <datalist id={`cmds-${t.id}`}>
                  {options.map((o) => (
                    <option key={o} value={o} />
                  ))}
                </datalist>
              </label>

              <label className={styles.mini}>
                <span>When stopping, also run (optional)</span>
                <input
                  aria-label={`Terminal ${i + 1} stop command`}
                  value={t.stopCommand ?? ""}
                  list={`stops-${t.id}`}
                  onChange={(e) => update(i, { stopCommand: e.target.value })}
                  placeholder="Usually nothing. Docker needs e.g. docker stop db"
                  className={styles.mono}
                />
                <datalist id={`stops-${t.id}`}>{stopOption && <option value={stopOption} />}</datalist>
              </label>

              {shells.length > 0 && (
                <label className={styles.mini}>
                  <span>Shell</span>
                  <select
                    aria-label={`Terminal ${i + 1} shell`}
                    value={t.shell ?? ""}
                    onChange={(e) => update(i, { shell: e.target.value || undefined })}
                  >
                    <option value="">Same as the app default</option>
                    {shells.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <details className={styles.advanced}>
                <summary>Advanced: environment variables</summary>
                <textarea
                  aria-label={`Terminal ${i + 1} environment`}
                  value={t.envText}
                  onChange={(e) => update(i, { envText: e.target.value })}
                  placeholder={"One per line:\nNAME=value"}
                  rows={2}
                  className={styles.mono}
                />
              </details>
              {runningTerminalIds.includes(t.id) && <p className={styles.note}>Takes effect the next time you start it.</p>}
            </fieldset>
          );
        })}

        <div className={styles.addRow}>
          <button className={styles.add} onClick={() => setRows((r) => [...r, toRow({ ...newTerminal(), name: uniqueName("terminal", r.map((x) => x.name)) })])}>
            + Add a terminal
          </button>
          <select
            aria-label="Add from template"
            value=""
            onChange={(e) => {
              addFromTemplate(e.target.value);
              e.target.value = "";
            }}
          >
            <option value="">Add from template…</option>
            {TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <p className={styles.hint}>
          Do not put passwords in commands. Use environment variables or a .env file read by the program itself.
        </p>
      </div>

      <div className={styles.foot}>
        {validation.errors.map((e) => (
          <p key={e} className={styles.error}>
            {e}
          </p>
        ))}
        {validation.warnings.map((w) => (
          <p key={w} className={styles.warn}>
            {w}
          </p>
        ))}
        {rootMissing && <p className={styles.warn}>Choose a project folder to continue.</p>}
        <div className={styles.buttons}>
          {!isNew && onDelete && (
            <button className={styles.delete} onClick={onDelete}>
              Delete app
            </button>
          )}
          <span className={styles.spacer} />
          <button onClick={onCancel}>Cancel</button>
          <button className={styles.save} disabled={!validation.ok || rootMissing} onClick={() => onSave(draft())}>
            Save
          </button>
        </div>
      </div>
    </aside>
  );
}
