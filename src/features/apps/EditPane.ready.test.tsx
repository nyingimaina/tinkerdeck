import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EditPane } from "./EditPane";
import type { AppDef } from "../../state/model";

vi.mock("../../api/tauri", () => ({
  pickFolder: vi.fn(async () => null),
  api: { detectProject: vi.fn(async () => []), suggestCommands: vi.fn(async () => []), listSubfolders: vi.fn(async () => []), dockerContainers: vi.fn(async () => []), listShells: vi.fn(async () => []) },
}));

const T = (id: string, name: string, extra: object = {}) => ({ id, name, cwd: ".", command: "npm run dev", env: {}, ...extra });
const helpers = (detect: unknown[] = []) => ({
  pick: async () => "E:\\code\\Shop",
  detectProject: async () => detect as never,
  suggestCommands: async () => [],
  listSubfolders: async () => [],
  dockerContainers: async () => [],
  listShells: async () => [],
});

const mount = (terminals = [T("1", "web")], detect: unknown[] = []) => {
  const onSave = vi.fn();
  render(
    <EditPane initial={{ id: "a", name: "A", root: "E:\\q", terminals }} isNew={false} runningTerminalIds={[]} onSave={onSave} onCancel={vi.fn()} helpers={helpers(detect)} />,
  );
  return onSave;
};

describe("readiness fields (used by `lcmd up --wait` and lc_up)", () => {
  it("can be set per terminal and are saved trimmed", async () => {
    const onSave = mount();
    await userEvent.type(screen.getByLabelText("Terminal 1 ready text"), "  Local:  ");
    await userEvent.type(screen.getByLabelText("Terminal 1 ready URL"), "http://localhost:5173/health");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((onSave.mock.calls[0][0] as AppDef).terminals[0]).toMatchObject({ readyPattern: "Local:", readyUrl: "http://localhost:5173/health" });
  });

  it("existing values are shown and empty ones are not written", async () => {
    const onSave = mount([T("1", "web", { readyPattern: "Now listening on" }), T("2", "db")]);
    expect(screen.getByLabelText("Terminal 1 ready text")).toHaveValue("Now listening on");
    expect(screen.getByLabelText("Terminal 2 ready text")).toHaveValue("");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const saved = (onSave.mock.calls[0][0] as AppDef).terminals;
    expect(saved[0].readyPattern).toBe("Now listening on");
    expect(saved[1].readyPattern).toBeUndefined();
    expect(saved[1].readyUrl).toBeUndefined();
  });

  it("clearing a field removes it", async () => {
    const onSave = mount([T("1", "web", { readyPattern: "Local:" })]);
    await userEvent.clear(screen.getByLabelText("Terminal 1 ready text"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((onSave.mock.calls[0][0] as AppDef).terminals[0].readyPattern).toBeUndefined();
  });

  it("a detected terminal arrives with its ready pattern already filled in", async () => {
    const onSave = vi.fn();
    render(
      <EditPane
        initial={{ id: "n", name: "", root: "", terminals: [] }}
        isNew
        runningTerminalIds={[]}
        onSave={onSave}
        onCancel={vi.fn()}
        helpers={helpers([{ name: "web", cwd: ".", command: "npm run dev", stopCommand: null, kind: "node", readyPattern: "Local:", primary: true }])}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Choose project folder/ }));
    await waitFor(() => expect(screen.getByLabelText("Terminal 1 ready text")).toHaveValue("Local:"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((onSave.mock.calls[0][0] as AppDef).terminals[0].readyPattern).toBe("Local:");
  });
});
