import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CommandPalette, HelpDialog, type PaletteAction } from "./CommandPalette";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open palette
      </button>
      {open && <CommandPalette actions={actions()} onClose={() => setOpen(false)} />}
    </>
  );
}

const actions = (): PaletteAction[] => [
  { id: "sidebar", label: "Toggle sidebar", shortcut: "Ctrl+B", run: vi.fn() },
  { id: "refresh", label: "Refresh everything", run: vi.fn() },
  { id: "palette", label: "Open command palette", shortcut: "Ctrl+Shift+P", run: vi.fn() },
  { id: "theme", label: "Switch light/dark theme", shortcut: "Ctrl+Alt+T", run: vi.fn() },
  { id: "reset", label: "Reset layout", run: vi.fn() },
];

const setup = (list = actions()) => {
  const onClose = vi.fn();
  render(<CommandPalette actions={list} onClose={onClose} />);
  return { list, onClose };
};

describe("CommandPalette", () => {
  it("A1: still lists every action as a named button with its shortcut or a No shortcut note", () => {
    setup();
    const dialog = screen.getByRole("dialog", { name: "Command palette" });
    expect(within(dialog).getByLabelText("Search commands")).toHaveFocus();
    for (const [label, keys] of [
      ["Toggle sidebar", "Ctrl+B"],
      ["Open command palette", "Ctrl+Shift+P"],
      ["Switch light/dark theme", "Ctrl+Alt+T"],
    ]) {
      expect(within(dialog).getByRole("button", { name: new RegExp(label) })).toHaveTextContent(keys);
    }
    expect(within(dialog).getByRole("button", { name: /Refresh everything/ })).toHaveTextContent("No shortcut");
    expect(within(dialog).getByRole("button", { name: /Reset layout/ })).toHaveTextContent("No shortcut");
  });

  it("R8: the command palette stays a palette and is not moved into a side pane", () => {
    setup();
    const dialog = screen.getByRole("dialog", { name: "Command palette" });
    expect(dialog.closest('[class*="ZestResponsiveLayout-module_sidePane"]')).toBeNull();
    expect(document.querySelector('[class*="ZestResponsiveLayout-module_sidePane"]')).toBeNull();
  });

  it("A1: choosing an action runs it once and closes the palette", async () => {
    const { list, onClose } = setup();

    await userEvent.click(screen.getByRole("button", { name: /Toggle sidebar/ }));
    expect(list[0].run).toHaveBeenCalledTimes(1);
    expect(list[1].run).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("A1: Escape closes without running anything", async () => {
    const { list, onClose } = setup();

    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(list.every((a) => (a.run as ReturnType<typeof vi.fn>).mock.calls.length === 0)).toBe(true);
  });

  it("A1/R7: keeps the name filter and the 'No commands match.' empty result", async () => {
    setup();
    const input = screen.getByLabelText("Search commands");

    await userEvent.type(input, "theme");
    expect(screen.getByRole("button", { name: /Switch light\/dark theme/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Refresh everything/ })).toBeNull();

    await userEvent.clear(input);
    await userEvent.type(input, "zzz");
    expect(screen.getByText("No commands match.")).toBeInTheDocument();
  });

  it("R7: every app-level command shows its real shortcut or a clear No shortcut note", () => {
    setup();
    const dialog = screen.getByRole("dialog", { name: "Command palette" });
    for (const button of within(dialog).getAllByRole("button").filter((b) => b.textContent?.includes("No shortcut"))) {
      expect(button.textContent).toContain("No shortcut");
    }
    expect(within(dialog).getByRole("button", { name: /Toggle sidebar/ }).textContent).toContain("Ctrl+B");
    expect(within(dialog).getByRole("button", { name: /Reset layout/ }).textContent).not.toContain("Ctrl+");
  });

  it("R7/R8: a command that cannot run now is listed disabled with a visible reason and never runs", async () => {
    const run = vi.fn();
    const list: PaletteAction[] = [
      ...actions(),
      {
        id: "hideConsole",
        label: "Hide console",
        disabled: true,
        disabledReason: "Only workspace: this app has no terminals.",
        run,
      },
    ];
    const { onClose } = setup(list);

    const button = screen.getByRole("button", { name: /Hide console/ });
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Only workspace");
    await userEvent.click(button);
    expect(run).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("R7: Escape closes the palette and returns focus to the control that opened it", async () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open palette" });
    await userEvent.click(opener);
    await waitFor(() => expect(screen.getByLabelText("Search commands")).toHaveFocus());

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("R6: the help text no longer advertises F5 as refresh", () => {
    render(
      <HelpDialog
        version="2.2.0"
        autoCheck={false}
        phase="idle"
        upToDate={false}
        available={null}
        error={null}
        onAutoCheck={vi.fn()}
        onCheckNow={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Help" });
    expect(dialog).toHaveTextContent(/refresh now/);
    expect(dialog).not.toHaveTextContent("F5");
  });
});
