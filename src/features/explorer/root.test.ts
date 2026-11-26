import { describe, expect, it } from "vitest";
import { explorerRoot, isDriveRoot, parentFolder, type ExplorerRootOptions } from "./root";

const APPS = [
  { id: "outer", name: "Outer", root: "C:\\work\\proj" },
  { id: "inner", name: "Inner", root: "C:\\work\\proj\\packages\\inner" },
  { id: "other", name: "Other", root: "D:\\other" },
];

const at = (over: Partial<ExplorerRootOptions>) =>
  explorerRoot({ view: "home", apps: APPS, selectedAppId: null, activePath: null, ...over });

describe("explorer root", () => {
  it("R4 in the app view the root is the selected app's root", () => {
    expect(at({ view: "app", selectedAppId: "outer" })).toEqual({ root: "C:\\work\\proj", appId: "outer", source: "app" });
  });

  it("R4 switching to another app moves the root", () => {
    expect(at({ view: "app", selectedAppId: "other" }).root).toBe("D:\\other");
  });

  it("R4 in the editor view the root is the app that owns the active tab", () => {
    expect(at({ view: "editor", activePath: "C:\\work\\proj\\src\\a.ts" })).toEqual({
      root: "C:\\work\\proj",
      appId: "outer",
      source: "app",
    });
  });

  it("R4 with nested roots the deepest root containing the file owns it", () => {
    expect(at({ view: "editor", activePath: "C:\\work\\proj\\packages\\inner\\src\\a.ts" }).appId).toBe("inner");
  });

  it("R4 opening a file under the current root keeps the same owning app", () => {
    expect(at({ view: "editor", activePath: "C:\\work\\proj\\README.md" })).toEqual({
      root: "C:\\work\\proj",
      appId: "outer",
      source: "app",
    });
  });

  it("R4 a file outside every app root is not guessed into the nearest app", () => {
    expect(at({ view: "editor", activePath: "E:\\loose\\file.txt" })).toEqual({
      root: "E:\\loose",
      appId: null,
      source: "misc",
    });
  });

  it("R4 a path written with other slashes or case still finds its owner", () => {
    expect(at({ view: "editor", activePath: "c:/WORK/proj/File.TS" }).appId).toBe("outer");
  });

  it("R4 an app with no root has nothing to show", () => {
    const apps = [{ id: "blank", name: "Blank", root: "  " }];
    expect(at({ view: "app", selectedAppId: "blank", apps })).toEqual({ root: null, appId: null, source: "none" });
  });

  it("R5 a Misc file roots at its parent folder, not the home folder", () => {
    expect(at({ view: "editor", activePath: "C:\\Users\\me\\work\\loose\\notes.txt" })).toEqual({
      root: "C:\\Users\\me\\work\\loose",
      appId: null,
      source: "misc",
    });
  });

  it("R5 a Misc file at the root of a drive roots at that drive and Up reaches the drive list", () => {
    const result = at({ view: "editor", activePath: "D:\\file.txt" });
    expect(result).toEqual({ root: "D:\\", appId: null, source: "misc" });
    expect(isDriveRoot("D:\\")).toBe(true);
    expect(parentFolder("D:\\")).toBeNull();
  });

  it("R5 Up climbs one folder at a time up to the drive list", () => {
    const steps: (string | null)[] = [];
    let current: string | null = "C:\\Users\\me\\work\\loose";
    while (current) {
      steps.push(current);
      current = parentFolder(current);
    }
    expect(steps).toEqual(["C:\\Users\\me\\work\\loose", "C:\\Users\\me\\work", "C:\\Users\\me", "C:\\Users", "C:\\"]);
  });

  it("R5 switching between two Misc files moves the root", () => {
    expect(at({ view: "editor", activePath: "C:\\a\\one.txt" }).root).toBe("C:\\a");
    expect(at({ view: "editor", activePath: "E:\\b\\two.txt" }).root).toBe("E:\\b");
  });

  it("R5 switching from an app-owned tab to a Misc tab moves the root to the Misc parent", () => {
    expect(at({ view: "editor", activePath: "C:\\work\\proj\\src\\a.ts" }).root).toBe("C:\\work\\proj");
    expect(at({ view: "editor", activePath: "E:\\loose\\file.txt" }).root).toBe("E:\\loose");
  });

  it("R13 the home view roots at the user's home folder", () => {
    expect(at({ view: "home", homeFolder: "C:\\Users\\me" })).toEqual({
      root: "C:\\Users\\me",
      appId: null,
      source: "home",
    });
  });

  it("R13 the editor view with no tab open roots at the home folder", () => {
    expect(at({ view: "editor", activePath: null, homeFolder: "C:\\Users\\me" })).toEqual({
      root: "C:\\Users\\me",
      appId: null,
      source: "home",
    });
  });

  it("R13 an unsaved tab with no path roots at the home folder", () => {
    expect(at({ view: "editor", activePath: null, homeFolder: "D:\\Users\\other" })).toEqual({
      root: "D:\\Users\\other",
      appId: null,
      source: "home",
    });
  });

  it("R13 an app root still wins over the home folder", () => {
    expect(at({ view: "app", selectedAppId: "outer", homeFolder: "C:\\Users\\me" })).toEqual({
      root: "C:\\work\\proj",
      appId: "outer",
      source: "app",
    });
  });

  it("R13 a Misc file still roots at its parent folder, not the home folder", () => {
    expect(at({ view: "editor", activePath: "E:\\loose\\file.txt", homeFolder: "C:\\Users\\me" })).toEqual({
      root: "E:\\loose",
      appId: null,
      source: "misc",
    });
  });

  it("A1 without a home folder from the core the home view has no root, so the panel shows its hint", () => {
    expect(at({ view: "home", homeFolder: null })).toEqual({ root: null, appId: null, source: "none" });
  });

  it("A1 without a home folder from the core an editor view with no path has no root", () => {
    expect(at({ view: "editor", activePath: null, homeFolder: null })).toEqual({ root: null, appId: null, source: "none" });
  });
});
