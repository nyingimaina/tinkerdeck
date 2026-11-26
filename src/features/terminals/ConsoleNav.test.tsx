import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConsoleNav } from "./ConsoleNav";
import type { TermState } from "../../state/model";

const entries = [
  { id: "console-a:1", n: 1, shell: null },
  { id: "console-a:2:gitbash", n: 2, shell: "gitbash" },
];
const shells = [
  { id: "powershell.exe", name: "Windows PowerShell" },
  { id: "gitbash", name: "Git Bash" },
  { id: "wsl.exe", name: "WSL" },
];
const running: TermState = { kind: "running" };

const setup = (over: Partial<React.ComponentProps<typeof ConsoleNav>> = {}) => {
  const h = { onSelect: vi.fn(), onAdd: vi.fn(), onClose: vi.fn() };
  render(<ConsoleNav consoles={entries} activeId="console-a:1" stateOf={() => running} shells={shells} {...h} {...over} />);
  return h;
};

describe("ConsoleNav", () => {
  it("lists every console with its shell and marks the active one", () => {
    setup();
    const list = screen.getByRole("list");
    expect(within(list).getByRole("button", { name: "Console 1, default shell" })).toHaveAttribute("aria-current", "true");
    expect(within(list).getByRole("button", { name: "Console 2, Git Bash" })).not.toHaveAttribute("aria-current");
  });

  it("selects a console", async () => {
    const h = setup();
    await userEvent.click(screen.getByRole("button", { name: "Console 2, Git Bash" }));
    expect(h.onSelect).toHaveBeenCalledWith("console-a:2:gitbash");
  });

  it("+ adds a console with the default shell", async () => {
    const h = setup();
    await userEvent.click(screen.getByRole("button", { name: "New console" }));
    expect(h.onAdd).toHaveBeenCalledWith(null);
  });

  it("the arrow offers the installed shells and adds with the chosen one", async () => {
    const h = setup();
    await userEvent.click(screen.getByRole("button", { name: "Choose shell for a new console" }));
    const items = screen.getAllByRole("menuitem").map((i) => i.textContent);
    expect(items).toEqual(["Windows PowerShell", "Git Bash", "WSL"]);
    await userEvent.click(screen.getByRole("menuitem", { name: "Git Bash" }));
    expect(h.onAdd).toHaveBeenCalledWith("gitbash");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("the first (parent) console cannot be closed; the others can", async () => {
    const h = setup();
    expect(screen.getByRole("button", { name: "Close Console 1" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Close Console 2" }));
    expect(h.onClose).toHaveBeenCalledWith("console-a:2:gitbash");
  });

  it("shows a status notice such as the auto-restart message", () => {
    setup({ notice: "Shell ended with code 0 and was restarted." });
    expect(screen.getByRole("status")).toHaveTextContent("restarted");
  });

  it("copes with no detected shells", async () => {
    setup({ shells: [] });
    await userEvent.click(screen.getByRole("button", { name: "Choose shell for a new console" }));
    expect(screen.getByText("No other shells found.")).toBeInTheDocument();
  });

  it("A1: keeps the console list's select, add and close behaviour after the hide control is added", async () => {
    const h = setup({ onHide: vi.fn() });
    await userEvent.click(screen.getByRole("button", { name: "Console 2, Git Bash" }));
    expect(h.onSelect).toHaveBeenCalledWith("console-a:2:gitbash");
    await userEvent.click(screen.getByRole("button", { name: "New console" }));
    expect(h.onAdd).toHaveBeenCalledWith(null);
    await userEvent.click(screen.getByRole("button", { name: "Close Console 2" }));
    expect(h.onClose).toHaveBeenCalledWith("console-a:2:gitbash");
    expect(screen.getByRole("button", { name: "Close Console 1" })).toBeDisabled();
  });

  it("R8: Hide console hides it without closing, and is disabled with a visible reason when it is the only workspace", async () => {
    const onHide = vi.fn();
    const props = { consoles: entries, activeId: "console-a:1", stateOf: () => running, shells, onSelect: vi.fn(), onAdd: vi.fn(), onClose: vi.fn() };
    const { rerender } = render(<ConsoleNav {...props} onHide={onHide} />);

    await userEvent.click(screen.getByRole("button", { name: "Hide console" }));
    expect(onHide).toHaveBeenCalledTimes(1);

    rerender(<ConsoleNav {...props} onHide={onHide} hideDisabledReason="Only workspace: this app has no terminals." />);
    const hide = screen.getByRole("button", { name: "Hide console" });
    expect(hide).toBeDisabled();
    expect(screen.getByText("Only workspace: this app has no terminals.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close Console 1" })).toBeDisabled();
  });
});
