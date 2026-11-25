import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CommandPalette, type PaletteAction } from "./CommandPalette";

const actions = (): PaletteAction[] => [
  { id: "sidebar", label: "Toggle sidebar", shortcut: "Ctrl+B", run: vi.fn() },
  { id: "refresh", label: "Refresh everything", shortcut: "F5", run: vi.fn() },
  { id: "palette", label: "Open command palette", shortcut: "Ctrl+Shift+P", run: vi.fn() },
  { id: "theme", label: "Switch light/dark theme", shortcut: "Ctrl+Alt+T", run: vi.fn() },
];

describe("CommandPalette", () => {
  it("R4: lists the revision-1 actions with the same shortcut beside each", () => {
    render(<CommandPalette actions={actions()} onClose={vi.fn()} />);

    const dialog = screen.getByRole("dialog", { name: "Command palette" });
    expect(within(dialog).getByLabelText("Search commands")).toHaveFocus();
    for (const [label, keys] of [
      ["Toggle sidebar", "Ctrl+B"],
      ["Refresh everything", "F5"],
      ["Open command palette", "Ctrl+Shift+P"],
      ["Switch light/dark theme", "Ctrl+Alt+T"],
    ]) {
      expect(within(dialog).getByRole("button", { name: new RegExp(label) })).toHaveTextContent(keys);
    }
  });

  it("R4: filters by name and says so when nothing matches", async () => {
    render(<CommandPalette actions={actions()} onClose={vi.fn()} />);
    const input = screen.getByLabelText("Search commands");

    await userEvent.type(input, "theme");
    expect(screen.getByRole("button", { name: /Switch light\/dark theme/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Refresh everything/ })).toBeNull();

    await userEvent.clear(input);
    await userEvent.type(input, "zzz");
    expect(screen.getByText("No commands match.")).toBeInTheDocument();
  });

  it("A4: choosing an action runs it once and closes the palette", async () => {
    const list = actions();
    const onClose = vi.fn();
    render(<CommandPalette actions={list} onClose={onClose} />);

    await userEvent.click(screen.getByRole("button", { name: /Toggle sidebar/ }));
    expect(list[0].run).toHaveBeenCalledTimes(1);
    expect(list[1].run).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("A4: Escape closes without running anything", async () => {
    const list = actions();
    const onClose = vi.fn();
    render(<CommandPalette actions={list} onClose={onClose} />);

    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(list.every((a) => (a.run as ReturnType<typeof vi.fn>).mock.calls.length === 0)).toBe(true);
  });
});
