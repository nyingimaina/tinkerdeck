import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExplorerEntry, ExplorerListing } from "../../api/explorer";

const api = vi.hoisted(() => ({ list: vi.fn(), drives: vi.fn() }));
vi.mock("../../api/explorer", () => ({ explorerApi: api }));

import { useExplorer, MAX_CACHED_LEVELS, type ExploreOptions } from "./useExplorer";

const file = (path: string): ExplorerEntry => ({ name: path.split("\\").pop() ?? path, path, isDir: false, locked: false });
const folder = (path: string, locked = false): ExplorerEntry => ({
  name: path.split("\\").pop() ?? path,
  path,
  isDir: true,
  locked,
});
const listing = (path: string, entries: ExplorerEntry[] = [], extra: Partial<ExplorerListing> = {}): ExplorerListing => ({
  path,
  entries,
  total: extra.total ?? entries.length,
  truncated: extra.truncated ?? false,
  locked: extra.locked ?? false,
});

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

const mount = async (options: ExploreOptions) => {
  const hook = renderHook((props: ExploreOptions) => useExplorer(props), { initialProps: options });
  await flush();
  return hook;
};

const callsTo = (path: string) => api.list.mock.calls.filter((c) => c[0] === path);

beforeEach(() => {
  api.list.mockReset();
  api.drives.mockReset();
  api.list.mockImplementation(async (path: string) => listing(path));
  api.drives.mockResolvedValue([{ name: "C:", path: "C:\\", isDir: true, locked: false }]);
});

describe("useExplorer", () => {
  it("R2 reads exactly one level: only the root folder, never its descendants", async () => {
    api.list.mockImplementation(async (path: string) =>
      listing(path, path === "C:\\proj" ? [folder("C:\\proj\\src"), file("C:\\proj\\README.md")] : []),
    );
    const { result } = await mount({ root: "C:\\proj", source: "app" });

    expect(api.list).toHaveBeenCalledTimes(1);
    expect(api.list).toHaveBeenCalledWith("C:\\proj", false);
    expect(result.current.rootLevel.listing?.entries.map((e) => e.name)).toEqual(["src", "README.md"]);
  });

  it("R2 a folder's children are requested only when it is first expanded, and not again", async () => {
    api.list.mockImplementation(async (path: string) =>
      listing(path, path === "C:\\proj" ? [folder("C:\\proj\\src")] : [file("C:\\proj\\src\\a.ts")]),
    );
    const { result } = await mount({ root: "C:\\proj", source: "app" });

    expect(callsTo("C:\\proj\\src")).toHaveLength(0); // not read before the user opens it

    act(() => result.current.toggleFolder("C:\\proj\\src"));
    act(() => result.current.ensure("C:\\proj\\src"));
    await flush();
    expect(callsTo("C:\\proj\\src")).toHaveLength(1);
    expect(result.current.levelOf("C:\\proj\\src").listing?.entries.map((e) => e.name)).toEqual(["a.ts"]);

    act(() => result.current.toggleFolder("C:\\proj\\src"));
    act(() => result.current.toggleFolder("C:\\proj\\src"));
    act(() => result.current.ensure("C:\\proj\\src"));
    await flush();
    expect(callsTo("C:\\proj\\src")).toHaveLength(1); // the cached level is reused
  });

  it("R2 toggling Show hidden re-reads the shown levels with the hidden names on, and off again", async () => {
    api.list.mockImplementation(async (path: string, showHidden: boolean) =>
      listing(path, path === "C:\\proj" ? [folder("C:\\proj\\src")] : showHidden ? [folder("C:\\proj\\src\\node_modules")] : []),
    );
    const { result } = await mount({ root: "C:\\proj", source: "app" });
    act(() => result.current.toggleFolder("C:\\proj\\src"));
    act(() => result.current.ensure("C:\\proj\\src"));
    await flush();

    act(() => result.current.setShowHidden(true));
    await flush();
    expect(api.list).toHaveBeenCalledWith("C:\\proj", true);
    expect(api.list).toHaveBeenCalledWith("C:\\proj\\src", true);
    expect(result.current.levelOf("C:\\proj\\src").listing?.entries.map((e) => e.name)).toEqual(["node_modules"]);

    act(() => result.current.setShowHidden(false));
    await flush();
    expect(callsTo("C:\\proj\\src").some((c) => c[1] === false)).toBe(true);
    expect(result.current.levelOf("C:\\proj\\src").listing?.entries).toEqual([]);
  });

  it("R2 a folder that cannot be read becomes a locked level instead of a thrown error", async () => {
    api.list.mockImplementation(async (path: string) => {
      if (path === "C:\\proj\\secret") throw new Error("Access denied");
      return listing(path, path === "C:\\proj" ? [folder("C:\\proj\\secret", true)] : []);
    });
    const { result } = await mount({ root: "C:\\proj", source: "app" });

    act(() => result.current.toggleFolder("C:\\proj\\secret"));
    act(() => result.current.ensure("C:\\proj\\secret"));
    await flush();
    expect(result.current.levelOf("C:\\proj\\secret").locked).toBe(true);
    expect(result.current.levelOf("C:\\proj\\secret").listing).toBeNull();
  });

  it("A1 keeps the visible total and truncated flag and does not re-read a level on re-render", async () => {
    api.list.mockImplementation(async (path: string) =>
      listing(path, [file("C:\\proj\\a.ts")], { total: 1200, truncated: true }),
    );
    const { result, rerender } = await mount({ root: "C:\\proj", source: "app" });
    expect(result.current.rootLevel.listing?.total).toBe(1200);
    expect(result.current.rootLevel.listing?.truncated).toBe(true);
    expect(api.list).toHaveBeenCalledTimes(1);

    rerender({ root: "C:\\proj", source: "app" });
    await flush();
    expect(api.list).toHaveBeenCalledTimes(1); // cached, not read on every render
  });

  it("A1 caches at most 100 levels and evicts the least recently used", async () => {
    const { result } = await mount({ root: "C:\\proj", source: "app" });
    await act(async () => {
      for (let i = 0; i < MAX_CACHED_LEVELS + 1; i += 1) result.current.ensure(`C:\\proj\\f${i}`);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.levelOf(`C:\\proj\\f${MAX_CACHED_LEVELS}`).listing).not.toBeNull();
    expect(result.current.levelOf("C:\\proj\\f0").listing).toBeNull(); // the oldest was dropped
  });

  it("R5 Up climbs a Misc folder one level at a time until the drive list", async () => {
    const { result } = await mount({ root: "C:\\Users\\me\\proj", source: "misc" });
    expect(result.current.canGoUp).toBe(true);

    act(() => result.current.up());
    expect(result.current.currentRoot).toBe("C:\\Users\\me");
    act(() => result.current.up());
    act(() => result.current.up());
    expect(result.current.currentRoot).toBe("C:\\");
    act(() => result.current.up());
    await flush();

    expect(result.current.atDrives).toBe(true);
    expect(result.current.canGoUp).toBe(false);
    expect(api.drives).toHaveBeenCalledTimes(1);
    expect(result.current.drives.map((d) => d.name)).toEqual(["C:"]);

    act(() => result.current.openDrive({ name: "D:", path: "D:\\", isDir: true, locked: false }));
    await flush();
    expect(result.current.atDrives).toBe(false);
    expect(result.current.currentRoot).toBe("D:\\");
  });

  it("R5 a Misc file at the root of a drive reaches the drive list in one Up", async () => {
    const { result } = await mount({ root: "D:\\", source: "misc" });
    act(() => result.current.up());
    await flush();
    expect(result.current.atDrives).toBe(true);
  });

  it("R4 an app root offers no Up, so its top folder stays the app root", async () => {
    const { result } = await mount({ root: "C:\\proj", source: "app" });
    expect(result.current.canGoUp).toBe(false);
    act(() => result.current.up());
    expect(result.current.currentRoot).toBe("C:\\proj");
    expect(result.current.atDrives).toBe(false);
  });

  it("R4/R5 a change of view, app or active tab discards Up navigation and returns to the automatic root", async () => {
    const { result, rerender } = await mount({ root: "C:\\a\\b", source: "misc", resetKey: "editor:tab1" });
    act(() => result.current.up());
    expect(result.current.currentRoot).toBe("C:\\a");

    rerender({ root: "C:\\c\\d", source: "misc", resetKey: "editor:tab2" });
    await flush();
    expect(result.current.currentRoot).toBe("C:\\c\\d");
    expect(result.current.atDrives).toBe(false);
    expect(api.list).toHaveBeenLastCalledWith("C:\\c\\d", false);
  });

  it("R13 a home root offers Up that climbs one folder at a time until the drive list", async () => {
    const { result } = await mount({ root: "C:\\Users\\me", source: "home" });
    expect(result.current.canGoUp).toBe(true);

    act(() => result.current.up());
    expect(result.current.currentRoot).toBe("C:\\Users");
    act(() => result.current.up());
    expect(result.current.currentRoot).toBe("C:\\");
    act(() => result.current.up());
    await flush();

    expect(result.current.atDrives).toBe(true);
    expect(result.current.canGoUp).toBe(false);
    expect(api.drives).toHaveBeenCalledTimes(1);
    expect(result.current.drives.map((d) => d.name)).toEqual(["C:"]);
  });

  it("R13 a drive that cannot be read shows as locked when opened instead of raising", async () => {
    api.list.mockImplementation(async (path: string) => {
      if (path === "D:\\") throw new Error("The device is not ready");
      return listing(path);
    });
    const { result } = await mount({ root: "C:\\Users\\me", source: "home" });

    act(() => result.current.openDrive({ name: "D:", path: "D:\\", isDir: true, locked: false }));
    await flush();

    expect(result.current.atDrives).toBe(false);
    expect(result.current.currentRoot).toBe("D:\\");
    expect(result.current.rootLevel.locked).toBe(true);
  });

  it("R13 a drive removed between listing and opening is reported without breaking the tree", async () => {
    api.list.mockImplementation(async (path: string) => {
      if (path === "D:\\") throw new Error("The system cannot find the drive specified.");
      return listing(path);
    });
    const { result, rerender } = await mount({ root: "C:\\Users\\me", source: "home" });

    act(() => result.current.openDrive({ name: "D:", path: "D:\\", isDir: true, locked: false }));
    await flush();
    expect(result.current.rootLevel.locked).toBe(true);

    // Browsing elsewhere still works: the removed drive left a locked level, not a broken tree.
    rerender({ root: "C:\\Users\\me", source: "home", resetKey: "back" });
    await flush();
    expect(result.current.currentRoot).toBe("C:\\Users\\me");
    expect(result.current.rootLevel.locked).toBe(false);
  });

  it("R13 an unreadable home folder shows a locked level and the rest keeps working", async () => {
    api.list.mockImplementation(async (path: string) => {
      if (path === "C:\\Users\\me") throw new Error("Access denied");
      return listing(path);
    });
    const { result } = await mount({ root: "C:\\Users\\me", source: "home" });
    expect(result.current.rootLevel.locked).toBe(true);
    expect(result.current.canGoUp).toBe(true);

    act(() => result.current.up());
    await flush();
    expect(result.current.currentRoot).toBe("C:\\Users");
    expect(result.current.rootLevel.locked).toBe(false);
  });

  it("A1 with no root nothing applies, so no folder is read", async () => {
    const { result } = await mount({ root: null, source: "none" });
    expect(result.current.currentRoot).toBeNull();
    expect(result.current.rootLevel.listing).toBeNull();
    expect(api.list).not.toHaveBeenCalled();
    expect(api.drives).not.toHaveBeenCalled();
  });
});
