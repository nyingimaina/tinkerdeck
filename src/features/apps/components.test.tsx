import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppHeader } from "./AppHeader";
import { Banner } from "./Banner";
import { Dialog } from "./Dialog";
import { EditPane } from "./EditPane";
import { EmptyState } from "./EmptyState";
import { Sidebar } from "./Sidebar";
import { StatusDot } from "../terminals/StatusDot";
import { TabStrip } from "../terminals/TabStrip";
import type { AppDef, TermState } from "../../state/model";

vi.mock("../../api/tauri", () => ({
  pickFolder: vi.fn(async () => "E:\\picked"),
  api: {
    detectProject: vi.fn(async () => []),
    suggestCommands: vi.fn(async () => []),
    listSubfolders: vi.fn(async () => []),
    dockerContainers: vi.fn(async () => []),
  },
}));

const T = (id: string, name: string) => ({ id, name, cwd: ".", command: "", env: {} });
const app: AppDef = { id: "a1", name: "Qonsol", root: "E:\\q", terminals: [T("t1", "db"), T("t2", "api"), T("t3", "web")] };
const st = (kind: TermState["kind"], extra: object = {}) => ({ kind, ...extra }) as TermState;

describe("StatusDot", () => {
  it("is not colour-only: exposes a label, a tick for success and a hollow ring for detached", () => {
    const { rerender } = render(<StatusDot state={st("exited", { code: 0 })} />);
    expect(screen.getByRole("img", { name: "Exited with code 0" })).toHaveTextContent("✓");
    rerender(<StatusDot state={st("detached")} />);
    expect(screen.getByRole("img").getAttribute("data-kind")).toBe("greenHollow");
    rerender(<StatusDot state={st("exited", { code: 3 })} />);
    expect(screen.getByRole("img", { name: "Exited with code 3" }).getAttribute("data-kind")).toBe("red");
  });
});

describe("AppHeader", () => {
  const base = { app, onStartAll: vi.fn(), onStopAll: vi.fn(), onEdit: vi.fn() };

  it("shows Start all when nothing is up and calls the handler", async () => {
    const onStartAll = vi.fn();
    render(<AppHeader {...base} onStartAll={onStartAll} states={[st("stopped"), st("exited", { code: 0 })]} />);
    await userEvent.click(screen.getByRole("button", { name: /Start all/ }));
    expect(onStartAll).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: /Stop all/ })).toBeNull();
  });

  it("shows Stop all when at least one terminal is up (including detached)", async () => {
    const onStopAll = vi.fn();
    render(<AppHeader {...base} onStopAll={onStopAll} states={[st("detached"), st("stopped")]} />);
    await userEvent.click(screen.getByRole("button", { name: /Stop all/ }));
    expect(onStopAll).toHaveBeenCalledOnce();
  });

  it("disables Start all when the app has no terminals", () => {
    render(<AppHeader {...base} app={{ ...app, terminals: [] }} states={[]} />);
    expect(screen.getByRole("button", { name: /Start all/ })).toBeDisabled();
  });
});

describe("Sidebar", () => {
  const stateOf = (id: string) => (id === "t1" ? st("detached") : id === "t2" ? st("running") : st("running"));

  it("lists apps and terminals with a roll-up dot and selects on click", async () => {
    const onSelectTerminal = vi.fn();
    render(
      <Sidebar
        apps={[app]}
        selectedAppId="a1"
        selectedTerminalId="t1"
        stateOf={stateOf}
        onSelectApp={vi.fn()}
        onSelectTerminal={onSelectTerminal}
      />,
    );
    expect(screen.getByRole("img", { name: "App status: green" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /api/ }));
    expect(onSelectTerminal).toHaveBeenCalledWith("a1", "t2");
  });

  it("collapses an app", async () => {
    render(
      <Sidebar apps={[app]} selectedAppId="a1" selectedTerminalId="t1" stateOf={() => st("stopped")} onSelectApp={vi.fn()} onSelectTerminal={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Collapse Qonsol" }));
    expect(screen.queryByRole("button", { name: /api/ })).toBeNull();
  });
});

describe("TabStrip", () => {
  const props = (state: TermState) => ({
    app,
    selectedTerminalId: "t1",
    stateOf: () => state,
    onSelect: vi.fn(),
    onStart: vi.fn(),
    onStop: vi.fn(),
    onRestart: vi.fn(),
  });

  it("only shows the app's terminals as tabs and marks the selected one", () => {
    render(<TabStrip {...props(st("stopped"))} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["db", "api", "web"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
  });

  it.each([
    ["stopped", { start: true, stop: false, restart: true }],
    ["running", { start: false, stop: true, restart: true }],
    ["detached", { start: false, stop: true, restart: true }],
    ["stopping", { start: false, stop: false, restart: false }],
    ["exited", { start: true, stop: false, restart: true }],
  ])("enables only allowed actions in %s and never hides a button", (kind, want) => {
    render(<TabStrip {...props(st(kind as TermState["kind"], kind === "exited" ? { code: 0 } : {}))} />);
    expect(screen.getByRole("button", { name: /Start/ }).hasAttribute("disabled")).toBe(!want.start);
    expect(screen.getByRole("button", { name: /Stop/ }).hasAttribute("disabled")).toBe(!want.stop);
    expect(screen.getByRole("button", { name: /Restart/ }).hasAttribute("disabled")).toBe(!want.restart);
  });
});

describe("EmptyState / Banner / Dialog", () => {
  it("empty state offers its action", async () => {
    const onClick = vi.fn();
    render(<EmptyState title="No apps yet." buttonLabel="Add your first app" onClick={onClick} />);
    await userEvent.click(screen.getByRole("button", { name: "Add your first app" }));
    expect(onClick).toHaveBeenCalled();
  });

  it("banner renders actions", async () => {
    const onClick = vi.fn();
    render(<Banner kind="error" actions={[{ label: "Open folder", onClick }]}>Could not read</Banner>);
    await userEvent.click(screen.getByRole("button", { name: "Open folder" }));
    expect(onClick).toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not read");
  });

  it("A4: dialog focuses the first (default) action, exposes one named dialog and runs each action", async () => {
    const stop = vi.fn();
    const keep = vi.fn();
    render(
      <Dialog title="Quit?" actions={[{ label: "Stop and quit", onClick: stop }, { label: "Keep running", onClick: keep }]}>
        2 terminals are running.
      </Dialog>,
    );
    expect(screen.getByRole("button", { name: "Stop and quit" })).toHaveFocus();
    expect(screen.getByRole("dialog", { name: "Quit?" })).toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Keep running" }));
    expect(keep).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
  });

  it("R8/A3: dialog is a side pane whose named close control runs the last (cancel) action", async () => {
    const stop = vi.fn();
    const cancel = vi.fn();
    render(
      <Dialog title="Quit?" actions={[{ label: "Stop and quit", onClick: stop }, { label: "Cancel", onClick: cancel }]}>
        2 terminals are running.
      </Dialog>,
    );
    expect(document.querySelector('[class*="ZestResponsiveLayout-module_sidePane"]')).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Close Quit?" }));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
  });

  it("R8/A3: Escape dismisses the side pane through the cancel action", async () => {
    const confirm = vi.fn();
    const cancel = vi.fn();
    render(
      <Dialog title="Delete Qonsol?" actions={[{ label: "Delete", onClick: confirm }, { label: "Cancel", onClick: cancel }]}>
        This removes the app.
      </Dialog>,
    );
    await userEvent.keyboard("{Escape}");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("R8/A3: a dialog with no actions keeps its content and offers no close path at all", async () => {
    render(
      <Dialog title="Update to 1.3.0" actions={[]}>
        Downloading. 50%
      </Dialog>,
    );
    expect(screen.getByText("Downloading. 50%")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Update to 1.3.0" })).toBeInTheDocument();
  });

  it("R8: a confirmation dialog keeps its title, body and action words in the pane", () => {
    render(
      <Dialog title="Delete Qonsol?" actions={[{ label: "Delete", kind: "danger", onClick: vi.fn() }, { label: "Cancel", onClick: vi.fn() }]}>
        This removes the app and its terminals.
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Delete Qonsol?" });
    expect(dialog).toHaveTextContent("This removes the app and its terminals.");
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });
});

describe("EditPane", () => {
  const setup = (over: Partial<React.ComponentProps<typeof EditPane>> = {}) => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(
      <EditPane initial={{ id: "n", name: "", root: "", terminals: [] }} isNew runningTerminalIds={[]} onSave={onSave} onCancel={onCancel} helpers={{ pick: async () => "E:\\picked" }} {...over} />,
    );
    return { onSave, onCancel };
  };

  it("keeps Save disabled until names and a root are filled in", async () => {
    const { onSave } = setup();
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText("Qonsol"), "My app");
    expect(save).toBeDisabled(); // root still empty
    await userEvent.type(screen.getByLabelText("Root folder"), "E:/code/my app");
    expect(save).toBeEnabled();
    await userEvent.click(save);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: "My app", root: "E:\\code\\my app" }));
  });

  it("uses the folder picker for Browse", async () => {
    setup();
    const rootField = screen.getByLabelText("Root folder");
    await userEvent.click(within(rootField.parentElement as HTMLElement).getByRole("button", { name: "Browse…" }));
    await waitFor(() => expect(rootField).toHaveValue("E:\\picked"));
    expect(rootField).toHaveValue("E:\\picked");
  });

  it("adds, edits, reorders and removes terminals; terminal needs a name", async () => {
    const { onSave } = setup();
    await userEvent.type(screen.getByPlaceholderText("Qonsol"), "A");
    await userEvent.type(screen.getByLabelText("Root folder"), "C:\\x");
    await userEvent.click(screen.getByRole("button", { name: "+ Add a terminal" }));
    await userEvent.click(screen.getByRole("button", { name: "+ Add a terminal" }));
    expect(screen.getByLabelText("Terminal 2 name")).toHaveValue("terminal 2"); // friendly default names
    await userEvent.clear(screen.getByLabelText("Terminal 2 name"));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled(); // a terminal needs a name
    await userEvent.type(screen.getByLabelText("Terminal 2 name"), "second");
    await userEvent.type(screen.getByLabelText("Terminal 2 stop command"), "docker stop db");
    await userEvent.type(screen.getByLabelText("Terminal 2 command"), "npm run dev");
    await userEvent.click(screen.getByRole("button", { name: "Move terminal 2 up" }));
    expect(screen.getByLabelText("Terminal 1 name")).toHaveValue("second");
    await userEvent.click(screen.getByRole("button", { name: "Remove terminal 2" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const saved = onSave.mock.calls[0][0] as AppDef;
    expect(saved.terminals).toHaveLength(1);
    expect(saved.terminals[0]).toMatchObject({ name: "second", command: "npm run dev", stopCommand: "docker stop db", cwd: "." });
  });

  it("warns about duplicate names without blocking save", async () => {
    setup({ initial: { id: "a", name: "A", root: "C:\\", terminals: [T("1", "api"), T("2", "api")] }, isNew: false });
    expect(screen.getByText(/Two terminals are called "api"/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("parses environment lines", async () => {
    const { onSave } = setup({ initial: { id: "a", name: "A", root: "C:\\", terminals: [T("1", "api")] }, isNew: false });
    await userEvent.type(screen.getByLabelText("Terminal 1 environment"), "ASPNETCORE_ENVIRONMENT=Development");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((onSave.mock.calls[0][0] as AppDef).terminals[0].env).toEqual({ ASPNETCORE_ENVIRONMENT: "Development" });
  });

  it("says a running terminal's changes take effect next start", () => {
    setup({ initial: app, isNew: false, runningTerminalIds: ["t2"] });
    expect(screen.getAllByText("Takes effect the next time you start it.")).toHaveLength(1);
  });

  it("offers Delete only for existing apps", async () => {
    const onDelete = vi.fn();
    setup({ initial: app, isNew: false, onDelete });
    await userEvent.click(screen.getByRole("button", { name: "Delete app" }));
    expect(onDelete).toHaveBeenCalled();
  });

  it("Cancel closes without saving", async () => {
    const { onSave, onCancel } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
