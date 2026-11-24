import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/themes", () => ({
  themeApi: { searchOnline: vi.fn(), fetchOnline: vi.fn(), scanLocal: vi.fn(), readLocal: vi.fn() },
}));

import { themeApi } from "../api/themes";
import { useThemeFinder, type FinderController } from "./useThemeFinder";
import type { GalleryEntry, Theme } from "./types";

const m = themeApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

const entry = (id: string, over: Partial<GalleryEntry> = {}): GalleryEntry => ({
  id,
  name: `Ext ${id}`,
  publisher: "pub",
  description: "d",
  downloads: 10,
  version: "1.0.0",
  icon: null,
  source: "online",
  location: `pub/${id}`,
  ...over,
});
const pkg = {
  themes: [{ label: "Night", uiTheme: "vs-dark", path: "t/n.json" }],
  files: { "t/n.json": JSON.stringify({ colors: { "editor.background": "#101820" } }) },
};

let ctl: { current: FinderController };
const onInstall = vi.fn();
function Probe({ open }: { open: boolean }) {
  ctl.current = useThemeFinder({ open, onInstall });
  return null;
}
const mount = async (open = true) => {
  await act(async () => {
    render(<Probe open={open} />);
  });
};

beforeEach(() => {
  ctl = { current: undefined as unknown as FinderController };
  onInstall.mockReset();
  for (const k of Object.keys(m)) m[k].mockReset();
  m.searchOnline.mockResolvedValue([entry("a"), entry("b")]);
  m.scanLocal.mockResolvedValue([entry("L1", { source: "local", location: "C:/x/L1" })]);
  m.fetchOnline.mockResolvedValue(pkg);
  m.readLocal.mockResolvedValue(pkg);
});

describe("useThemeFinder", () => {
  it("opens on the online registry and lists the popular themes straight away", async () => {
    await mount();
    expect(ctl.current.tab).toBe("online");
    expect(m.searchOnline).toHaveBeenCalledWith("");
    expect(ctl.current.entries.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("does nothing while closed", async () => {
    await mount(false);
    expect(m.searchOnline).not.toHaveBeenCalled();
    expect(m.scanLocal).not.toHaveBeenCalled();
  });

  it("searches for what was typed", async () => {
    await mount();
    act(() => ctl.current.setQuery("  dracula "));
    await act(async () => ctl.current.search());
    expect(m.searchOnline).toHaveBeenLastCalledWith("dracula");
  });

  it("lists the themes already installed on this PC on the other tab", async () => {
    await mount();
    await act(async () => ctl.current.setTab("local"));
    expect(m.scanLocal).toHaveBeenCalled();
    expect(ctl.current.entries.map((e) => e.id)).toEqual(["L1"]);
  });

  it("installs an online extension and hands its themes over", async () => {
    await mount();
    await act(async () => ctl.current.install(ctl.current.entries[0]));
    expect(m.fetchOnline).toHaveBeenCalledWith("pub", "a");
    expect(onInstall).toHaveBeenCalledTimes(1);
    const themes = onInstall.mock.calls[0][0] as Theme[];
    expect(themes[0].name).toBe("Night");
    expect(ctl.current.done.has("a")).toBe(true);
    expect(ctl.current.installing).toBeNull();
  });

  it("installs a local extension from its folder", async () => {
    await mount();
    await act(async () => ctl.current.setTab("local"));
    await act(async () => ctl.current.install(ctl.current.entries[0]));
    expect(m.readLocal).toHaveBeenCalledWith("C:/x/L1");
    expect(onInstall).toHaveBeenCalled();
  });

  it("explains a failed install and leaves the entry installable", async () => {
    m.fetchOnline.mockRejectedValue("Could not reach the theme registry. Check your internet connection.");
    await mount();
    await act(async () => ctl.current.install(ctl.current.entries[0]));
    expect(ctl.current.error).toMatch(/Could not reach/);
    expect(ctl.current.done.has("a")).toBe(false);
    expect(onInstall).not.toHaveBeenCalled();
  });

  it("explains an extension that has no colour themes", async () => {
    m.fetchOnline.mockResolvedValue({ themes: [], files: {} });
    await mount();
    await act(async () => ctl.current.install(ctl.current.entries[0]));
    expect(ctl.current.error).toMatch(/no colour themes/i);
  });

  it("shows the registry's trouble instead of an empty list", async () => {
    m.searchOnline.mockRejectedValue("Could not reach the theme registry. Check your internet connection.");
    await mount();
    expect(ctl.current.error).toMatch(/Could not reach/);
    expect(ctl.current.entries).toEqual([]);
    expect(ctl.current.loading).toBe(false);
  });

  it("only the latest search counts when answers arrive out of order", async () => {
    let first!: (v: GalleryEntry[]) => void;
    m.searchOnline.mockReset();
    m.searchOnline.mockImplementationOnce(() => new Promise((r) => (first = r))); // the opening search, slow
    await mount();
    m.searchOnline.mockResolvedValueOnce([entry("fast")]);
    act(() => ctl.current.setQuery("x"));
    await act(async () => ctl.current.search());
    await act(async () => first([entry("slow")]));
    expect(ctl.current.entries.map((e) => e.id)).toEqual(["fast"]);
  });
});
