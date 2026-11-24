import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/themes", () => ({ themeApi: { load: vi.fn(), save: vi.fn() } }));

import { themeApi } from "../api/themes";
import { useThemes, type ThemesController } from "./useThemes";
import { BUILTIN_THEMES } from "./builtin";
import type { Theme } from "./types";

const m = themeApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

const imported = (id: string, kind: "dark" | "light" = "dark"): Theme => ({ ...BUILTIN_THEMES[kind === "dark" ? 0 : 1], id, name: `Imported ${id}`, source: "vscode" });

let ctl: { current: ThemesController };
const setKind = vi.fn(async () => {});
function Probe(p: { kind: "dark" | "light" | undefined; ready?: boolean }) {
  ctl.current = useThemes({ kind: p.kind, ready: p.ready ?? true, setKind });
  return null;
}
const mount = async (kind: "dark" | "light" | undefined = "dark") => {
  await act(async () => {
    render(<Probe kind={kind} />);
  });
};

beforeEach(() => {
  ctl = { current: undefined as unknown as ThemesController };
  m.load.mockReset().mockResolvedValue({ active: null, imported: [] });
  m.save.mockReset().mockResolvedValue(undefined);
  setKind.mockClear();
  document.documentElement.removeAttribute("style");
});

describe("useThemes", () => {
  it("starts on the Tinkerdeck theme that matches the saved dark or light setting", async () => {
    await mount("dark");
    expect(ctl.current.active.id).toBe("tinkerdeck-dark");
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe(BUILTIN_THEMES[0].ui.accent);
  });

  it("follows a saved light setting when no theme was chosen yet", async () => {
    await mount("light");
    expect(ctl.current.active.id).toBe("tinkerdeck-light");
  });

  it("restores the theme chosen last time, including an imported one", async () => {
    m.load.mockResolvedValue({ active: "vsc-a", imported: [imported("vsc-a")] });
    await mount("dark");
    expect(ctl.current.active.id).toBe("vsc-a");
    expect(ctl.current.themes.map((t) => t.id)).toEqual([...BUILTIN_THEMES.map((t) => t.id), "vsc-a"]);
  });

  it("falls back to the default when the saved theme no longer exists", async () => {
    m.load.mockResolvedValue({ active: "vsc-gone", imported: [] });
    await mount("dark");
    expect(ctl.current.active.id).toBe("tinkerdeck-dark");
  });

  it("selecting a theme applies it, saves the choice, and keeps the dark or light setting in step", async () => {
    await mount("dark");
    await act(async () => ctl.current.select("tinkerdeck-light"));
    expect(ctl.current.active.id).toBe("tinkerdeck-light");
    expect(m.save).toHaveBeenLastCalledWith({ active: "tinkerdeck-light", imported: [] });
    expect(setKind).toHaveBeenCalledWith("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    await act(async () => ctl.current.select("classic-light"));
    expect(setKind).toHaveBeenCalledTimes(1); // still light: nothing to change
  });

  it("installing themes adds them, selects the first and saves them", async () => {
    await mount("dark");
    await act(async () => ctl.current.install([imported("vsc-1"), imported("vsc-2", "light")]));
    expect(ctl.current.active.id).toBe("vsc-1");
    expect(ctl.current.themes.filter((t) => t.source === "vscode").map((t) => t.id)).toEqual(["vsc-1", "vsc-2"]);
    expect(m.save).toHaveBeenLastCalledWith(expect.objectContaining({ active: "vsc-1" }));
    expect((m.save.mock.calls[m.save.mock.calls.length - 1][0] as { imported: Theme[] }).imported).toHaveLength(2);
  });

  it("installing the same theme again replaces it instead of duplicating it", async () => {
    await mount("dark");
    await act(async () => ctl.current.install([imported("vsc-1")]));
    await act(async () => ctl.current.install([{ ...imported("vsc-1"), name: "Renamed" }]));
    expect(ctl.current.themes.filter((t) => t.id === "vsc-1")).toHaveLength(1);
    expect(ctl.current.themes.find((t) => t.id === "vsc-1")!.name).toBe("Renamed");
  });

  it("imports a theme file and says what is wrong with one that is not a theme", async () => {
    await mount("dark");
    let err: string | null = "x";
    await act(async () => {
      err = await ctl.current.importText(JSON.stringify({ name: "Mine", colors: { "editor.background": "#101010" } }), "mine.json");
    });
    expect(err).toBeNull();
    expect(ctl.current.active.name).toBe("Mine");
    const count = ctl.current.themes.length;
    await act(async () => {
      err = await ctl.current.importText("{ nope", "bad.json");
    });
    expect(err).toMatch(/not valid JSON/i);
    expect(ctl.current.themes).toHaveLength(count);
  });

  it("removing the theme in use falls back to the default of its kind", async () => {
    m.load.mockResolvedValue({ active: "vsc-a", imported: [imported("vsc-a", "light")] });
    await mount("light");
    await act(async () => ctl.current.remove("vsc-a"));
    expect(ctl.current.active.id).toBe("tinkerdeck-light");
    expect(ctl.current.themes.some((t) => t.id === "vsc-a")).toBe(false);
    expect((m.save.mock.calls[m.save.mock.calls.length - 1][0] as { imported: Theme[] }).imported).toEqual([]);
  });

  it("built-in themes cannot be removed", async () => {
    await mount("dark");
    await act(async () => ctl.current.remove("tinkerdeck-dark"));
    expect(ctl.current.themes.some((t) => t.id === "tinkerdeck-dark")).toBe(true);
  });

  it("the quick toggle swaps to the matching light or dark theme", async () => {
    await mount("dark");
    await act(async () => ctl.current.toggleKind());
    expect(ctl.current.active.id).toBe("tinkerdeck-light");
    await act(async () => ctl.current.toggleKind());
    expect(ctl.current.active.id).toBe("tinkerdeck-dark");
  });

  it("still works when the saved settings cannot be read", async () => {
    m.load.mockRejectedValue("disk trouble");
    await mount("dark");
    expect(ctl.current.active.id).toBe("tinkerdeck-dark");
  });

  it("waits for the saved dark or light setting before choosing", async () => {
    await act(async () => {
      render(<Probe kind={undefined} ready={false} />);
    });
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("");
  });
});
