import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ThemePicker } from "./ThemePicker";
import { BUILTIN_THEMES } from "../../themes/builtin";
import type { Theme } from "../../themes/types";

const night: Theme = { ...BUILTIN_THEMES[0], id: "vsc-night", name: "Night Owl", source: "vscode" };

function setup(over: Partial<Parameters<typeof ThemePicker>[0]> = {}) {
  const p = {
    themes: [...BUILTIN_THEMES, night],
    activeId: "tinkerdeck-dark",
    onSelect: vi.fn(),
    onRemove: vi.fn(),
    onImportText: vi.fn(async () => null as string | null),
    onFind: vi.fn(),
    ...over,
  };
  render(<ThemePicker {...p} />);
  return p;
}

describe("ThemePicker", () => {
  it("opens a menu listing the built-in themes and the imported ones, with the active one marked", async () => {
    setup();
    expect(screen.queryByRole("menu")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Theme" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(5);
    expect(within(menu).getByRole("menuitemradio", { name: /Tinkerdeck Dark/ }).getAttribute("aria-checked")).toBe("true");
    expect(within(menu).getByRole("menuitemradio", { name: /Night Owl/ }).getAttribute("aria-checked")).toBe("false");
    expect(within(menu).getByText("Imported")).toBeTruthy();
  });

  it("choosing a theme selects it and closes the menu", async () => {
    const p = setup();
    await userEvent.click(screen.getByRole("button", { name: "Theme" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: /Night Owl/ }));
    expect(p.onSelect).toHaveBeenCalledWith("vsc-night");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("only imported themes can be removed", async () => {
    const p = setup();
    await userEvent.click(screen.getByRole("button", { name: "Theme" }));
    expect(screen.queryByRole("button", { name: "Remove Tinkerdeck Dark" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Remove Night Owl" }));
    expect(p.onRemove).toHaveBeenCalledWith("vsc-night");
  });

  it("imports a VS Code theme file", async () => {
    const p = setup();
    await userEvent.click(screen.getByRole("button", { name: "Theme" }));
    const input = screen.getByLabelText("Import a VS Code theme file") as HTMLInputElement;
    expect(input.accept).toContain(".json");
    const file = new File(['{"colors":{}}'], "mine-color-theme.json", { type: "application/json" });
    await userEvent.upload(input, file);
    await waitFor(() => expect(p.onImportText).toHaveBeenCalledWith('{"colors":{}}', "mine-color-theme.json"));
  });

  it("tells you why an import failed", async () => {
    setup({ onImportText: vi.fn(async () => "That file is not valid JSON.") });
    await userEvent.click(screen.getByRole("button", { name: "Theme" }));
    await userEvent.upload(screen.getByLabelText("Import a VS Code theme file"), new File(["x"], "bad.json"));
    expect(await screen.findByRole("alert")).toHaveTextContent("not valid JSON");
  });

  it("offers to find more themes", async () => {
    const p = setup();
    await userEvent.click(screen.getByRole("button", { name: "Theme" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Find more themes…" }));
    expect(p.onFind).toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes with Escape", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Theme" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
