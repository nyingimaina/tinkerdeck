import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BUILTIN_THEMES } from "../../themes/builtin";
import { TopBar } from "./TopBar";

const props = () => ({
  sidebarCollapsed: false,
  onToggleSidebar: vi.fn(),
  shell: "powershell.exe",
  shells: [
    { id: "powershell.exe", name: "Windows PowerShell", path: "a" },
    { id: "pwsh.exe", name: "PowerShell 7", path: "b" },
  ],
  onShellChange: vi.fn(),
  themeKind: "dark" as const,
  onToggleTheme: vi.fn(),
  themes: BUILTIN_THEMES,
  activeThemeId: BUILTIN_THEMES[0].id,
  onSelectTheme: vi.fn(),
  onRemoveTheme: vi.fn(),
  onImportTheme: vi.fn(async () => null),
  onFindThemes: vi.fn(),
  onAddApp: vi.fn(),
  addDisabled: false,
  editorActive: false,
  onEditor: vi.fn(),
  onCheckUpdates: vi.fn(),
  updatesBusy: false,
  updateAvailable: null,
  onRefresh: vi.fn(),
  onHelp: vi.fn(),
});

describe("TopBar groups", () => {
  it("R3: groups related controls into named groups and keeps Shell, Theme and the primary actions directly reachable", () => {
    render(<TopBar {...props()} />);

    const brand = screen.getByRole("group", { name: "Brand" });
    const appearance = screen.getByRole("group", { name: "Appearance" });
    const create = screen.getByRole("group", { name: "Create" });
    expect(screen.getByRole("group", { name: "Utilities" })).toBeInTheDocument();

    expect(within(brand).getByRole("button", { name: "Hide sidebar" })).toBeInTheDocument();
    expect(within(appearance).getByLabelText("Shell")).toBeInTheDocument();
    expect(within(appearance).getByRole("button", { name: "Theme" })).toBeInTheDocument();
    expect(within(appearance).getByRole("button", { name: "Toggle theme" })).toBeInTheDocument();
    expect(within(create).getByRole("button", { name: "+ App" })).toBeInTheDocument();
  });

  it("R3: hides the advanced controls until Utilities is opened, and every hidden control has its way back", async () => {
    const p = props();
    render(<TopBar {...p} />);

    expect(screen.queryByRole("menuitem")).toBeNull();
    expect(screen.queryByRole("button", { name: "Editor" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Utilities" }));
    const menu = screen.getByRole("menu", { name: "Utilities" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.getAttribute("aria-label"))).toEqual([
      "Editor",
      "Check for updates",
      "Refresh everything",
      "Help",
    ]);

    await userEvent.click(within(menu).getByRole("menuitem", { name: "Editor" }));
    expect(p.onEditor).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("R3: an available update stays noticeable while Updates sits inside Utilities", async () => {
    render(<TopBar {...props()} updateAvailable="1.3.0" />);

    const trigger = screen.getByRole("button", { name: "Utilities, update 1.3.0 available" });
    expect(trigger).toHaveTextContent("●"); // the badge is visible without opening anything

    await userEvent.click(trigger);
    expect(screen.getByRole("menuitem", { name: "Check for updates" })).toHaveTextContent("1.3.0");
  });

  it("R3: keeps every group in the header flow so a narrow window wraps instead of clipping them", () => {
    render(<TopBar {...props()} />);
    const header = screen.getByRole("banner");
    const groups = within(header).getAllByRole("group");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["Brand", "Appearance", "Create", "Utilities"]);
    groups.forEach((group) => expect(group.parentElement).toBe(header));
  });
});
