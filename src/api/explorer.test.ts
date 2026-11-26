import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { explorerApi, type ExplorerEntry, type ExplorerListing } from "./explorer";

const emptyListing = (path: string): ExplorerListing => ({ path, entries: [], total: 0, truncated: false, locked: false });

beforeEach(() => invoke.mockReset());

describe("explorerApi", () => {
  it("R2 lists one level through explorer_list, passing the folder and camelCase showHidden", async () => {
    const listing = emptyListing("C:\\work\\proj");
    invoke.mockResolvedValue(listing);

    await expect(explorerApi.list("C:\\work\\proj", true)).resolves.toEqual(listing);
    expect(invoke).toHaveBeenCalledWith("explorer_list", { path: "C:\\work\\proj", showHidden: true });
  });

  it("R2 asks for the same folder with showHidden off when hidden names are hidden", async () => {
    invoke.mockResolvedValue(emptyListing("C:\\work\\proj"));

    await explorerApi.list("C:\\work\\proj", false);
    expect(invoke).toHaveBeenCalledWith("explorer_list", { path: "C:\\work\\proj", showHidden: false });
  });

  it("R5 lists the drive roots through explorer_drives", async () => {
    const drives: ExplorerEntry[] = [{ name: "C:", path: "C:\\", isDir: true, locked: false }];
    invoke.mockResolvedValue(drives);

    await expect(explorerApi.drives()).resolves.toEqual(drives);
    expect(invoke).toHaveBeenCalledWith("explorer_drives");
  });
});
