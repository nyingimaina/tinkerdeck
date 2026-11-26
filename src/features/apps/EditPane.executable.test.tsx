import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EditPane } from "./EditPane";
import type { AppDef, TerminalDef } from "../../state/model";

vi.mock("../../api/tauri", () => ({
  pickFolder: vi.fn(async () => null),
  api: {
    detectProject: vi.fn(async () => []),
    suggestCommands: vi.fn(async () => []),
    listSubfolders: vi.fn(async () => []),
    dockerContainers: vi.fn(async () => []),
  },
}));

const T = (id: string, name: string, extra: Partial<TerminalDef> = {}): TerminalDef => ({
  id,
  name,
  cwd: ".",
  command: "",
  env: {},
  ...extra,
});

const setup = (terminals: TerminalDef[]) => {
  const onSave = vi.fn();
  const app: AppDef = { id: "a", name: "A", root: "E:\\q", terminals };
  render(
    <EditPane
      initial={app}
      isNew={false}
      runningTerminalIds={[]}
      onSave={onSave}
      onCancel={vi.fn()}
      helpers={{ pick: async () => null }}
    />,
  );
  return { onSave };
};

describe("the terminal executable flag (R11)", () => {
  it("R11: a newly added terminal is executable by default and saves that way", async () => {
    const { onSave } = setup([]);
    await userEvent.click(screen.getByRole("button", { name: "+ Add a terminal" }));

    const box = screen.getByLabelText("Terminal 1 executable") as HTMLInputElement;
    expect(box).toBeChecked();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((onSave.mock.calls[0][0] as AppDef).terminals[0].executable).toBe(true);
  });

  it("R11: a saved terminal without the flag loads as executable and is saved explicitly", async () => {
    const { onSave } = setup([T("1", "web")]);
    expect(screen.getByLabelText("Terminal 1 executable")).toBeChecked();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((onSave.mock.calls[0][0] as AppDef).terminals[0].executable).toBe(true);
  });

  it("R11: marking one terminal non-executable saves only that terminal's flag", async () => {
    const { onSave } = setup([T("1", "web"), T("2", "api")]);
    const box = screen.getByLabelText("Terminal 2 executable") as HTMLInputElement;

    await userEvent.click(box);
    expect(box).not.toBeChecked();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const saved = onSave.mock.calls[0][0] as AppDef;
    expect(saved.terminals.map((t) => t.executable)).toEqual([true, false]);
  });

  it("R11: the flag can be turned off and on again and the saved value follows it", async () => {
    const { onSave } = setup([T("1", "web")]);
    const box = screen.getByLabelText("Terminal 1 executable") as HTMLInputElement;

    await userEvent.click(box);
    await userEvent.click(box);
    expect(box).toBeChecked();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((onSave.mock.calls[0][0] as AppDef).terminals[0].executable).toBe(true);
  });

  it("R11: a non-executable terminal keeps its name, command and remove controls", () => {
    setup([T("1", "web", { command: "npm run dev", executable: false })]);
    expect(screen.getByLabelText("Terminal 1 executable")).not.toBeChecked();
    expect(screen.getByLabelText("Terminal 1 name")).toHaveValue("web");
    expect(screen.getByLabelText("Terminal 1 command")).toHaveValue("npm run dev");
    expect(screen.getByRole("button", { name: "Remove terminal 1" })).toBeInTheDocument();
    expect(screen.getByText("Include in Start all / Stop all (and F5)")).toBeInTheDocument();
  });
});
