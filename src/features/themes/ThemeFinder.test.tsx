// @ts-expect-error -- Node's fs is available to the test runner; the window build ships no Node types.
import { readFileSync } from "node:fs";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ThemeFinder } from "./ThemeFinder";
import type { FinderController } from "../../themes/useThemeFinder";
import type { GalleryEntry } from "../../themes/types";

const entry = (id: string, over: Partial<GalleryEntry> = {}): GalleryEntry => ({
  id,
  name: `Theme ${id}`,
  publisher: "someone",
  description: `About ${id}`,
  downloads: 1234567,
  version: "1.2.3",
  icon: null,
  source: "online",
  location: `someone/${id}`,
  ...over,
});

function controller(over: Partial<FinderController> = {}): FinderController {
  return {
    tab: "online",
    setTab: vi.fn(),
    query: "",
    setQuery: vi.fn(),
    search: vi.fn(),
    entries: [entry("a"), entry("b")],
    loading: false,
    error: null,
    install: vi.fn(),
    installing: null,
    done: new Set<string>(),
    ...over,
  } as FinderController;
}

// The layout requirement is CSS-only, so the test reads the stylesheet Vite would ship.
const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
const finderCss = () => readFileSync(`${cwd}/src/features/themes/Themes.module.css`, "utf8");

describe("ThemeFinder", () => {
  it("has an Online and an On this PC tab", async () => {
    const c = controller();
    render(<ThemeFinder finder={c} />);
    expect(screen.getByRole("tab", { name: "Online" }).getAttribute("aria-selected")).toBe("true");
    await userEvent.click(screen.getByRole("tab", { name: "On this PC" }));
    expect(c.setTab).toHaveBeenCalledWith("local");
  });

  it("shows each theme with who made it and how popular it is", () => {
    render(<ThemeFinder finder={controller()} />);
    const card = screen.getByText("Theme a").closest("li") as HTMLElement;
    expect(within(card).getByText(/someone/)).toBeTruthy();
    expect(within(card).getByText(/1\.2M/)).toBeTruthy();
    expect(within(card).getByText("About a")).toBeTruthy();
  });

  it("installs with one click", async () => {
    const c = controller();
    render(<ThemeFinder finder={c} />);
    await userEvent.click(screen.getByRole("button", { name: "Install Theme a" }));
    expect(c.install).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  it("shows progress, and what is already installed", () => {
    render(<ThemeFinder finder={controller({ installing: "a", done: new Set(["b"]) })} />);
    expect((screen.getByRole("button", { name: "Installing Theme a" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Installed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Install Theme b" })).toBeNull();
  });

  it("searches when you press Enter", async () => {
    const c = controller();
    render(<ThemeFinder finder={c} />);
    const box = screen.getByRole("searchbox", { name: "Search themes" });
    await userEvent.type(box, "dracula{Enter}");
    expect(c.setQuery).toHaveBeenLastCalledWith("a");
    expect(c.search).toHaveBeenCalled();
  });

  it("has no search box for themes already on this PC", () => {
    render(<ThemeFinder finder={controller({ tab: "local", entries: [entry("L", { source: "local" })] })} />);
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.getByText(/VS Code/i)).toBeTruthy();
  });

  it("explains an empty list and shows errors plainly", () => {
    const { rerender } = render(<ThemeFinder finder={controller({ entries: [], tab: "local" })} />);
    expect(screen.getByText(/No VS Code themes were found on this PC/i)).toBeTruthy();
    rerender(<ThemeFinder finder={controller({ entries: [], error: "Could not reach the theme registry. Check your internet connection." })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not reach");
  });

  it("says it is loading", () => {
    render(<ThemeFinder finder={controller({ loading: true, entries: [] })} />);
    expect(screen.getByText(/Searching/i)).toBeTruthy();
  });

  it("says where the themes come from", () => {
    render(<ThemeFinder finder={controller()} />);
    expect(screen.getByText(/open-vsx\.org/i)).toBeTruthy();
  });

  it("R7: the finder fills its container instead of demanding a wider fixed width", () => {
    const css = finderCss();
    const block = css.match(/\.finder\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(block).toMatch(/width:\s*100%/);
    expect(block).toMatch(/min-width:\s*0/);
    expect(block).not.toMatch(/min\(\s*640px/);
    expect(css).not.toMatch(/\.finder\s*\{[^}]*80vw/s);
  });

  it("R7: a long theme name stays inside its row instead of widening it", () => {
    const css = finderCss();
    const cardBody = css.match(/\.cardBody\s*\{([^}]*)\}/)?.[1] ?? "";
    const cardTitle = css.match(/\.cardTitle\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(cardBody).toMatch(/min-width:\s*0/);
    expect(cardTitle).toMatch(/min-width:\s*0/);
    expect(cardTitle).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("R7: an empty search shows its message inside the finder, not past its edge", () => {
    render(<ThemeFinder finder={controller({ entries: [] })} />);
    const message = screen.getByText(/Nothing found/);
    expect(message).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).toBeNull();
  });
});
