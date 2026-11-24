import { describe, expect, it } from "vitest";
import { groupTabs, ownerOf, MISC } from "./editorGroups";

const app = (id: string, name: string, root: string) => ({ id, name, root, terminals: [] });
const apps = [app("q", "Qonsol", "E:\\work\\Qonsol"), app("api", "Qonsol API", "E:\\work\\Qonsol\\api"), app("l", "Lite", "D:/lite")];
const tab = (id: string, path: string | null, title = id) => ({ id, path, title, dirty: false, eol: "lf", encoding: "utf-8" });

describe("ownerOf", () => {
  it("finds the app whose folder holds the file, ignoring case and slash style", () => {
    expect(ownerOf("e:/WORK/qonsol/readme.md", apps)?.id).toBe("q");
    expect(ownerOf("D:\\lite\\src\\a.rs", apps)?.id).toBe("l");
  });

  it("picks the deepest folder when apps are nested", () => {
    expect(ownerOf("E:\\work\\Qonsol\\api\\Program.cs", apps)?.id).toBe("api");
    expect(ownerOf("E:\\work\\Qonsol\\web\\x.ts", apps)?.id).toBe("q");
  });

  it("matches whole folders only, never a shared name prefix", () => {
    expect(ownerOf("E:\\work\\Qonsol-old\\a.txt", apps)).toBeNull();
    expect(ownerOf("D:\\lite2\\a.txt", apps)).toBeNull();
  });

  it("has no owner for unknown places, unsaved documents and apps without a folder", () => {
    expect(ownerOf("C:\\Windows\\hosts", apps)).toBeNull();
    expect(ownerOf(null, apps)).toBeNull();
    expect(ownerOf("C:\\x\\a.txt", [app("n", "No folder", "")])).toBeNull();
  });
});

describe("groupTabs", () => {
  it("puts each editor under its app, in the apps' order, and the rest under Misc last", () => {
    const g = groupTabs(
      [tab("1", "D:/lite/a.rs"), tab("2", "C:/tmp/x.txt"), tab("3", "E:/work/Qonsol/b.md"), tab("4", null, "new 1"), tab("5", "E:/work/Qonsol/api/c.cs")],
      apps,
    );
    expect(g.map((x) => x.name)).toEqual(["Qonsol", "Qonsol API", "Lite", MISC]);
    expect(g.map((x) => x.tabs.map((t) => t.id))).toEqual([["3"], ["5"], ["1"], ["2", "4"]]);
    expect(g[3].appId).toBeNull();
    expect(g[0].appId).toBe("q");
  });

  it("leaves out apps with nothing open, and Misc when everything has an owner", () => {
    const g = groupTabs([tab("1", "D:/lite/a.rs")], apps);
    expect(g.map((x) => x.name)).toEqual(["Lite"]);
    expect(groupTabs([], apps)).toEqual([]);
  });

  it("keeps tabs in their original order inside a group", () => {
    const g = groupTabs([tab("b", "C:/b"), tab("a", "C:/a")], []);
    expect(g[0].tabs.map((t) => t.id)).toEqual(["b", "a"]);
  });
});
