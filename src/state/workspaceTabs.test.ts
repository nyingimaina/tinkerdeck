import { describe, expect, it } from "vitest";
import { editorsOf, globalActiveTab, partitionTabs, selectedWorkspaceTab } from "./workspaceTabs";

const app = (id: string, name: string, root: string) => ({ id, name, root });
const apps = [app("q", "Qonsol", "E:\\work\\Qonsol"), app("api", "Qonsol API", "E:\\work\\Qonsol\\api"), app("l", "Lite", "D:/lite")];
const tab = (id: string, path: string | null, title = id) => ({ id, path, title });

describe("partitionTabs: one owner per editor (R2, R3, R4)", () => {
  it("R3: files under a workspace root go to that workspace, deepest root winning", () => {
    const p = partitionTabs(
      [tab("root", "E:/work/Qonsol/readme.md"), tab("deep", "E:/work/Qonsol/api/Program.cs"), tab("other", "D:/lite/a.rs")],
      apps,
    );
    expect(p.byApp.q.map((t) => t.id)).toEqual(["root"]);
    expect(p.byApp.api.map((t) => t.id)).toEqual(["deep"]);
    expect(p.byApp.l.map((t) => t.id)).toEqual(["other"]);
    expect(p.unowned).toEqual([]);
  });

  it("R3: two roots that tie for depth give the file to the first saved workspace", () => {
    const equal = [app("first", "First", "C:/same"), app("second", "Second", "C:\\same\\")];
    const p = partitionTabs([tab("x", "C:/same/x.txt")], equal);
    expect(p.byApp.first.map((t) => t.id)).toEqual(["x"]);
    expect(p.byApp).not.toHaveProperty("second");
    expect(editorsOf(p, "second")).toEqual([]);
  });

  it("R3: a path outside every root (or unsaved) belongs to no workspace", () => {
    const p = partitionTabs([tab("loose", "C:/tmp/x.txt"), tab("new", null, "new 1")], apps);
    expect(p.unowned.map((t) => t.id)).toEqual(["loose", "new"]);
    expect(Object.keys(p.byApp)).toEqual([]);
  });

  it("R3: slash direction, trailing separators and capitalisation do not change the owner", () => {
    const p = partitionTabs(
      [tab("a", "e:\\WORK\\qonsol\\A.TXT"), tab("b", "E:/work/Qonsol/api/")],
      apps,
    );
    expect(p.byApp.q.map((t) => t.id)).toEqual(["a"]);
    expect(p.byApp.api.map((t) => t.id)).toEqual(["b"]);
    expect(p.unowned).toEqual([]);
  });

  it("R2: the unowned list holds only files with no workspace home, never an owned file", () => {
    const p = partitionTabs(
      [tab("owned", "E:/work/Qonsol/a.txt"), tab("loose", "C:/tmp/b.txt"), tab("new", null)],
      apps,
    );
    expect(p.unowned.map((t) => t.id)).toEqual(["loose", "new"]);
    expect(p.unowned.some((t) => t.id === "owned")).toBe(false);
  });

  it("R4: every open editor lands in exactly one bucket, with no copy", () => {
    const tabs = [
      tab("a", "E:/work/Qonsol/a.txt"),
      tab("b", "E:/work/Qonsol/api/b.cs"),
      tab("c", "D:/lite/c.rs"),
      tab("d", "C:/tmp/d.txt"),
      tab("n", null),
    ];
    const p = partitionTabs(tabs, apps);
    const all = [...Object.values(p.byApp).flat(), ...p.unowned].map((t) => t.id);
    expect(all.sort()).toEqual(["a", "b", "c", "d", "n"]);
    expect(new Set(all).size).toBe(tabs.length);
  });

  it("R4: a tab that moves roots moves to the new strip without being duplicated", () => {
    const before = partitionTabs([tab("a", "E:/work/Qonsol/api/a.txt")], apps);
    expect(before.byApp.api.map((t) => t.id)).toEqual(["a"]);

    const after = partitionTabs([tab("a", "D:/lite/a.txt")], apps);
    expect(after.byApp.api).toBeUndefined();
    expect(after.byApp.l.map((t) => t.id)).toEqual(["a"]);
    expect(after.unowned).toEqual([]);
  });

  it("R4: a tab re-pointed from a workspace root to an unowned path and back keeps its text and dirty mark in one strip", () => {
    const doc = { id: "a", path: "E:/work/Qonsol/api/a.txt", title: "a.txt", content: "a draft", dirty: true };

    // Saved outside every root: the same single tab moves to the global (unowned) list.
    const unowned = partitionTabs([{ ...doc, path: "C:/tmp/a.txt" }], apps);
    expect(unowned.byApp).toEqual({});
    expect(unowned.unowned.map((t) => t.id)).toEqual(["a"]);
    expect(unowned.unowned).toHaveLength(1);
    expect(unowned.unowned[0]).toMatchObject({ content: "a draft", dirty: true });

    // Saved back under a root: still one tab, now only in that workspace's strip.
    const owned = partitionTabs([{ ...doc, path: "E:/work/Qonsol/api/a.txt" }], apps);
    expect(owned.unowned).toEqual([]);
    expect(owned.byApp.api.map((t) => t.id)).toEqual(["a"]);
    expect(owned.byApp.api).toHaveLength(1);
    expect(owned.byApp.q).toBeUndefined();
    expect(owned.byApp.l).toBeUndefined();
    expect(owned.byApp.api[0]).toMatchObject({ content: "a draft", dirty: true });
  });

  it("R3/R4: changing a workspace root re-files the tab under the new owner with its text and dirty mark intact", () => {
    const doc = { id: "a", path: "E:/work/Qonsol/api/a.txt", title: "a.txt", content: "a draft", dirty: true };
    expect(partitionTabs([doc], apps).byApp.api.map((t) => t.id)).toEqual(["a"]);

    // The deepest workspace's root moves away, so the file now belongs to its parent workspace.
    const moved = apps.map((a) => (a.id === "api" ? { ...a, root: "E:/work/Qonsol2" } : a));
    const afterMove = partitionTabs([doc], moved);
    expect(afterMove.byApp.api).toBeUndefined();
    expect(afterMove.byApp.q.map((t) => t.id)).toEqual(["a"]);
    expect(afterMove.byApp.q).toHaveLength(1);
    expect(afterMove.unowned).toEqual([]);
    expect(afterMove.byApp.q[0]).toMatchObject({ content: "a draft", dirty: true });

    // The parent root moves away too, so the same single tab has no workspace home at all.
    const gone = moved.map((a) => (a.id === "q" ? { ...a, root: "F:/elsewhere" } : a));
    const afterRootGone = partitionTabs([doc], gone);
    expect(afterRootGone.byApp).toEqual({});
    expect(afterRootGone.unowned.map((t) => t.id)).toEqual(["a"]);
    expect(afterRootGone.unowned).toHaveLength(1);
    expect(afterRootGone.unowned[0]).toMatchObject({ content: "a draft", dirty: true });
  });

  it("R1/R3: deleting a workspace re-files its tabs under the remaining owner or the global view, never both", () => {
    const tabs = [tab("a", "E:/work/Qonsol/api/a.txt"), tab("b", "E:/work/Qonsol/readme.md")];
    expect(partitionTabs(tabs, apps).byApp.api.map((t) => t.id)).toEqual(["a"]);

    // Delete the deepest workspace: its file now belongs to the parent workspace.
    const withoutApi = partitionTabs(tabs, [apps[0], apps[2]]);
    expect(withoutApi.byApp.api).toBeUndefined();
    expect(withoutApi.byApp.q.map((t) => t.id)).toEqual(["a", "b"]);

    // Delete that workspace too: both files now have no home.
    const withoutQ = partitionTabs(tabs, [apps[2]]);
    expect(withoutQ.byApp).toEqual({});
    expect(withoutQ.unowned.map((t) => t.id)).toEqual(["a", "b"]);
  });
});

describe("selectedWorkspaceTab: one selected tab per workspace (R1)", () => {
  const base = { editorId: null, editorIds: [], selectedTerminalId: "t1" };

  it("uses the remembered editor tab while it is still open", () => {
    expect(selectedWorkspaceTab({ ...base, editorId: "e1", editorIds: ["e1", "e2"] })).toBe("e1");
  });

  it("falls back to the terminal when the remembered editor is gone or not open", () => {
    expect(selectedWorkspaceTab({ ...base, editorId: "gone", editorIds: ["e1"] })).toBe("t1");
    expect(selectedWorkspaceTab({ ...base, editorId: "gone", editorIds: [] })).toBe("t1");
  });

  it("shows the Console group when a Console instance is the selected terminal", () => {
    expect(
      selectedWorkspaceTab({ ...base, selectedTerminalId: "console-q:1", consoleTabId: "console-q" }),
    ).toBe("console-q");
    // A remembered editor still wins over the Console.
    expect(
      selectedWorkspaceTab({ ...base, editorId: "e1", editorIds: ["e1"], selectedTerminalId: "console-q:1", consoleTabId: "console-q" }),
    ).toBe("e1");
  });

  it("has no selection when nothing is selected and no editor is open", () => {
    expect(selectedWorkspaceTab({ editorId: null, editorIds: [], selectedTerminalId: null })).toBeNull();
  });
});

describe("globalActiveTab: the global strip stays on an unowned file (A2)", () => {
  const unowned = [tab("u1", "C:/tmp/a.txt"), tab("u2", "C:/tmp/b.txt")];

  it("keeps an unowned active tab, otherwise picks the first unowned tab", () => {
    expect(globalActiveTab(unowned, "u2")).toBe("u2");
    expect(globalActiveTab(unowned, "owned")).toBe("u1");
    expect(globalActiveTab([], "owned")).toBeNull();
  });
});
