import { useEffect, useMemo, useRef, useState } from "react";
import { Command } from "cmdk";
import type { UpdatePhase } from "../../state/useUpdates";
import { Dialog } from "../apps/Dialog";
import { UpdateSettingsBlock } from "../updates/UpdateUI";
import styles from "./CommandPalette.module.css";

export interface PaletteAction {
  id: string;
  label: string;
  /** Display text for the shortcut that also runs the action, e.g. "Ctrl+B". */
  shortcut?: string;
  /** When true the command is listed but cannot run now; the reason is shown beside it. */
  disabled?: boolean;
  disabledReason?: string;
  run: () => void;
}

interface Props {
  actions: readonly PaletteAction[];
  onClose: () => void;
}

/**
 * The command palette (R7/R10). cmdk 1.1.1 renders the searchable list inside the same dialog
 * shell and button rows as before: every app-level action is a real button with its name, its
 * real shortcut or a "No shortcut" note, and a visible reason when it cannot run now. Filtering
 * stays the existing case-insensitive name match (cmdk's own filter is off, so the observable
 * behaviour is unchanged), Escape closes it, and choosing an action runs it once and closes it.
 */
/** A place worth returning focus to: still in the page, not inside a hidden panel, not disabled. */
function canFocus(el: HTMLElement | null): el is HTMLElement {
  return !!el && el.isConnected && el.closest("[hidden]") === null && !(el as HTMLButtonElement).disabled;
}

export function CommandPalette({ actions, onClose }: Props) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  // Remember the control that opened the palette and hand focus back to it when the palette
  // closes, so a keyboard user is not dropped on the page body (R7). When nothing was focused
  // (opened by Ctrl+Shift+P from the page body) or that control is gone, land on the footer's
  // always-visible sidebar toggle, a named control that stays on screen.
  useEffect(() => {
    const active = document.activeElement;
    returnFocus.current = active instanceof HTMLElement && active !== document.body ? active : null;
    return () => {
      const target = returnFocus.current;
      returnFocus.current = null;
      if (canFocus(target)) target.focus();
      else document.querySelector<HTMLElement>('button[aria-label="Toggle sidebar"]')?.focus();
    };
  }, []);

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? actions.filter((a) => a.label.toLowerCase().includes(q)) : actions;
  }, [actions, query]);

  const choose = (action: PaletteAction) => {
    if (action.disabled) return;
    onClose();
    action.run();
  };

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="Command palette" className={styles.panel}>
        <Command shouldFilter={false} label="Command palette" className={styles.command}>
          <Command.Input
            ref={input}
            className={styles.search}
            aria-label="Search commands"
            placeholder="Type a command name."
            value={query}
            onValueChange={setQuery}
          />
          <Command.List className={styles.list} aria-label="Commands">
            {shown.map((action) => (
              <Command.Item
                key={action.id}
                value={action.id}
                disabled={action.disabled}
                onSelect={() => choose(action)}
                className={styles.item}
                asChild
              >
                <button
                  type="button"
                  role="button"
                  disabled={action.disabled}
                  title={action.disabled ? action.disabledReason : undefined}
                >
                  <span className={styles.label}>{action.label}</span>
                  {action.disabled && action.disabledReason && (
                    <span className={styles.reason}>{action.disabledReason}</span>
                  )}
                  {action.shortcut ? (
                    <kbd className={styles.kbd}>{action.shortcut}</kbd>
                  ) : (
                    <span className={styles.noShortcut}>No shortcut</span>
                  )}
                </button>
              </Command.Item>
            ))}
          </Command.List>
        </Command>
        {shown.length === 0 && <p className={styles.empty}>No commands match.</p>}
      </div>
    </div>
  );
}

export interface ConfirmDialogsProps {
  save: { count: number; onConfirm: () => void; onCancel: () => void } | null;
  deleteApp: { name: string; onConfirm: () => void; onCancel: () => void } | null;
  closeConsole: { title: string; onConfirm: () => void; onCancel: () => void } | null;
  switchBranch: {
    branch: string;
    runningCount: number;
    onStopStart: () => void;
    onSwitchAnyway: () => void;
    onCancel: () => void;
  } | null;
  restore: { names: string; onStart: () => void; onDismiss: () => void } | null;
  quit: { runningCount: number; onQuit: () => void; onKeep: () => void } | null;
}

/**
 * The short yes/no confirmation dialogs. They share the palette's on-demand chunk so none of
 * their bodies (titles, sentences and action words) is part of the initial view (R5); a dialog
 * loads this chunk the first time one of them opens.
 */
export function ConfirmDialogs({ save, deleteApp, closeConsole, switchBranch, restore, quit }: ConfirmDialogsProps) {
  return (
    <>
      {save && (
        <Dialog
          title="Stop running terminals?"
          actions={[
            { label: "Stop and save", kind: "primary", onClick: save.onConfirm },
            { label: "Cancel", onClick: save.onCancel },
          ]}
        >
          {save.count} terminal(s) you removed are still running. They will be stopped first.
        </Dialog>
      )}

      {deleteApp && (
        <Dialog
          title={`Delete ${deleteApp.name}?`}
          actions={[
            { label: "Delete", kind: "danger", onClick: deleteApp.onConfirm },
            { label: "Cancel", onClick: deleteApp.onCancel },
          ]}
        >
          This removes the app and its terminals from Tinkerdeck. Anything running is stopped first. Your project files
          are not touched.
        </Dialog>
      )}

      {closeConsole && (
        <Dialog
          title={`Close ${closeConsole.title}?`}
          actions={[
            { label: "Stop and close", kind: "danger", onClick: closeConsole.onConfirm },
            { label: "Cancel", onClick: closeConsole.onCancel },
          ]}
        >
          Something may still be running in it. It will be stopped first.
        </Dialog>
      )}

      {switchBranch && (
        <Dialog
          title={`Switch to ${switchBranch.branch}?`}
          actions={[
            { label: "Stop all, switch, Start all", kind: "primary", onClick: switchBranch.onStopStart },
            { label: "Switch anyway", onClick: switchBranch.onSwitchAnyway },
            { label: "Cancel", onClick: switchBranch.onCancel },
          ]}
        >
          {switchBranch.runningCount} terminal{switchBranch.runningCount === 1 ? " is" : "s are"} running. Switching
          branches changes the files they use, which can break a dev server or trigger rebuilds. Stop them first and
          start them again afterwards?
        </Dialog>
      )}

      {restore && (
        <Dialog
          title="Start the apps that were running last time?"
          actions={[
            { label: "Start them", kind: "primary", onClick: restore.onStart },
            { label: "No, thanks", onClick: restore.onDismiss },
          ]}
        >
          {restore.names}
        </Dialog>
      )}

      {quit && (
        <Dialog
          title="Quit Tinkerdeck?"
          actions={[
            { label: "Stop and quit", kind: "primary", onClick: quit.onQuit },
            { label: "Keep running", onClick: quit.onKeep },
          ]}
        >
          {quit.runningCount} terminal{quit.runningCount === 1 ? " is" : "s are"} running. Stop{" "}
          {quit.runningCount === 1 ? "it" : "them"} and quit?
        </Dialog>
      )}
    </>
  );
}

export interface HelpDialogProps {
  version: string;
  autoCheck: boolean;
  phase: UpdatePhase;
  upToDate: boolean;
  available: string | null;
  error: string | null;
  onAutoCheck: (v: boolean) => void;
  onCheckNow: () => void;
  onClose: () => void;
}

/**
 * The Help dialog. It shares the palette's on-demand chunk so neither the palette nor the help
 * text is part of the initial view (R5); opening either loads this chunk once.
 */
export function HelpDialog({ version, autoCheck, phase, upToDate, available, error, onAutoCheck, onCheckNow, onClose }: HelpDialogProps) {
  return (
    <Dialog title="Help" actions={[{ label: "Close", onClick: onClose }]}>
      <ul className={styles.help}>
        <li>An app is a group of terminals. Each terminal is a folder plus a command, run in the shell you choose.</li>
        <li>Home shows your favourites (star an app), recent apps and what is running now.</li>
        <li>Stop presses Ctrl+C first, then kills the whole process tree, so ports are released.</li>
        <li>
          Commands that start something and exit (such as <code>docker start db</code>) show as <b>Detached</b> when the
          terminal has a stop command (<code>docker stop db</code>). Without one they show Exited, and the container keeps
          running.
        </li>
        <li>
          The <b>&gt;_ Console</b> tab holds as many shells as you like (PowerShell, Git Bash, WSL, cmd). Use the list on the
          right to add or switch. Typing <code>exit</code> in the first console just starts a fresh shell.
        </li>
        <li>Pull is fast-forward only. For merges, rebases or force pushes use a console.</li>
        <li>Live state refreshes by itself while the window is visible. Press <b>⟳</b> or F5 to refresh now. Ctrl+B hides the sidebar.</li>
        <li>A terminal owns everything it starts: background processes it launches end when it stops.</li>
        <li>Do not put passwords in commands. Use environment variables or a .env file.</li>
      </ul>
      <UpdateSettingsBlock
        version={version}
        autoCheck={autoCheck}
        phase={phase}
        upToDate={upToDate}
        available={available}
        error={error}
        onAutoCheck={onAutoCheck}
        onCheckNow={onCheckNow}
      />
    </Dialog>
  );
}
