import { appButton, isExecutable, rollup, type AppDef, type TermState } from "../../state/model";
import { homeSections, relativeTime } from "../../state/home";
import { consoleId } from "../../state/console";
import { StatusDot } from "../terminals/StatusDot";
import styles from "./HomeScreen.module.css";

interface Props {
  apps: AppDef[];
  stateOf: (terminalId: string) => TermState;
  /** root folder -> exists on disk (missing keys are treated as existing). */
  folderExists: Record<string, boolean>;
  onOpen: (appId: string) => void;
  onStartAll: (appId: string) => void;
  onStopAll: (appId: string) => void;
  onToggleFavourite: (appId: string) => void;
  onAdd: () => void;
  onOpenFolder: () => void;
  /** Extra terminal ids of an app (its console instances) that count as running. */
  consoleIdsOf?: (appId: string) => string[];
}

type CardProps = Pick<Props, "stateOf" | "folderExists" | "onOpen" | "onStartAll" | "onStopAll" | "onToggleFavourite" | "consoleIdsOf"> & {
  app: AppDef;
  showTime?: boolean;
};

// Module-level components: defining them inside HomeScreen would remount every card on each render.
function Card({ app, showTime, stateOf, folderExists, onOpen, onStartAll, onStopAll, onToggleFavourite, consoleIdsOf }: CardProps) {
  // The dot and the Start all / Stop all state follow only executable terminals (R11); a
  // terminal marked non-executable never turns the card green or flips it to Stop. Consoles are
  // not configured terminals and keep counting as before.
  const executable = app.terminals.filter(isExecutable);
  const states = executable.map((t) => stateOf(t.id));
  const upCount = [...executable.map((t) => t.id), consoleId(app.id), ...(consoleIdsOf?.(app.id) ?? [])].filter((id) => {
    const s = stateOf(id);
    return s.kind === "running" || s.kind === "detached" || s.kind === "starting";
  }).length;
  const missing = folderExists[app.root] === false;
  return (
    <div className={`${styles.card} ${missing ? styles.missing : ""}`} data-app={app.id}>
      <button className={styles.cardMain} onClick={() => onOpen(app.id)} aria-label={`Open ${app.name}`}>
        <span className={styles.cardTitle}>
          <StatusDot rollup={rollup(states)} />
          <span className={styles.name}>{app.name}</span>
        </span>
        <span className={styles.root} title={app.root}>
          {app.root}
        </span>
        <span className={styles.sub}>
          {missing ? "Folder not found" : upCount > 0 ? `${upCount} running` : `${app.terminals.length} terminal${app.terminals.length === 1 ? "" : "s"}`}
          {showTime && app.lastOpened ? ` · ${relativeTime(app.lastOpened)}` : ""}
        </span>
      </button>
      <div className={styles.cardActions}>
        <button
          className={`${styles.star} ${app.favourite ? styles.starOn : ""}`}
          aria-label={app.favourite ? `Remove ${app.name} from favourites` : `Add ${app.name} to favourites`}
          aria-pressed={!!app.favourite}
          onClick={() => onToggleFavourite(app.id)}
        >
          {app.favourite ? "★" : "☆"}
        </button>
        {appButton(states) === "stop" || upCount > 0 ? (
          <button onClick={() => onStopAll(app.id)} aria-label={`Stop all in ${app.name}`}>
            ■ Stop all
          </button>
        ) : (
          <button disabled={missing || app.terminals.length === 0} onClick={() => onStartAll(app.id)} aria-label={`Start all in ${app.name}`}>
            ▶ Start all
          </button>
        )}
      </div>
    </div>
  );
}

function Section({ title, list, showTime, ...card }: Omit<CardProps, "app" | "showTime"> & { title: string; list: AppDef[]; showTime?: boolean }) {
  if (list.length === 0) return null;
  return (
    <section className={styles.section} aria-label={title}>
      <h3>{title}</h3>
      <div className={styles.grid}>
        {list.map((a) => (
          <Card key={a.id} app={a} showTime={showTime} {...card} />
        ))}
      </div>
    </section>
  );
}

export function HomeScreen({ apps, onAdd, onOpenFolder, ...card }: Props) {
  const { running, favourites, recent } = homeSections(apps, card.stateOf, card.consoleIdsOf);

  return (
    <div className={styles.home}>
      <h2 className={styles.title}>Home</h2>
      <Section title="Running now" list={running} {...card} />
      <Section title="Favourites" list={favourites} {...card} />
      <Section title="Recent" list={recent} showTime {...card} />
      {favourites.length === 0 && recent.length === 0 && running.length === 0 && (
        <p className={styles.hint}>Star an app to pin it here. Recently opened apps show up automatically.</p>
      )}
      <section className={styles.section} aria-label="Add">
        <h3>Add</h3>
        <div className={styles.grid}>
          <button className={styles.addCard} onClick={onOpenFolder}>
            <span className={styles.plus}>📁</span>
            Open folder…
            <small>Pick a project and we set it up</small>
          </button>
          <button className={styles.addCard} onClick={onAdd}>
            <span className={styles.plus}>＋</span>
            New app
            <small>Choose terminals yourself</small>
          </button>
        </div>
      </section>
      {apps.length > 0 && <Section title="All apps" list={apps} {...card} />}
    </div>
  );
}
