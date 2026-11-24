import { describe, expect, it } from "vitest";
import { consoleId, isConsoleId } from "./console";
import { homeSections, relativeTime } from "./home";
import {
  branchLabel,
  canCommit,
  filterBranches,
  graphRows,
  statusWord,
  type CommitInfo,
  type FileChange,
  type RepoInfo,
} from "./git";
import type { AppDef, TermState } from "./model";

const app = (id: string, over: Partial<AppDef> = {}): AppDef => ({
  id,
  name: id.toUpperCase(),
  root: `C:\\${id}`,
  terminals: [{ id: `${id}-t`, name: "t", cwd: ".", command: "", env: {} }],
  ...over,
});
const running: TermState = { kind: "running" };
const stopped: TermState = { kind: "stopped" };

describe("console ids", () => {
  it("derive from the app id and are recognised", () => {
    expect(consoleId("a1")).toBe("console-a1");
    expect(isConsoleId("console-a1")).toBe(true);
    expect(isConsoleId("2a8e1f4c-0b57-4d0e-9c1d-3e5f7a9b0c11")).toBe(false);
    expect(isConsoleId("console-")).toBe(false);
  });
});

describe("relativeTime", () => {
  const now = 1_700_000_000;
  it("speaks plainly", () => {
    expect(relativeTime(now - 10, now)).toBe("just now");
    expect(relativeTime(now - 5 * 60, now)).toBe("5m ago");
    expect(relativeTime(now - 2 * 3600, now)).toBe("2h ago");
    expect(relativeTime(now - 3 * 86400, now)).toBe("3d ago");
    expect(relativeTime(now - 40 * 86400, now)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("never shows a negative time for clock skew", () => {
    expect(relativeTime(now + 500, now)).toBe("just now");
  });
});

describe("homeSections", () => {
  const apps = [
    app("a", { favourite: true, lastOpened: 100 }),
    app("b", { lastOpened: 300 }),
    app("c", { favourite: true }),
    app("d", { lastOpened: 200 }),
    app("e"),
  ];
  const states: Record<string, TermState> = { "b-t": running };
  const stateOf = (id: string) => states[id] ?? stopped;

  it("favourites keep file order", () => {
    expect(homeSections(apps, stateOf).favourites.map((a) => a.id)).toEqual(["a", "c"]);
  });
  it("recent is newest first, only apps that were opened, and limited", () => {
    expect(homeSections(apps, stateOf).recent.map((a) => a.id)).toEqual(["b", "d", "a"]);
    const many = Array.from({ length: 12 }, (_, i) => app(`x${i}`, { lastOpened: i + 1 }));
    const r = homeSections(many, stateOf).recent;
    expect(r).toHaveLength(8);
    expect(r[0].id).toBe("x11");
  });
  it("running now lists apps with something up", () => {
    expect(homeSections(apps, stateOf).running.map((a) => a.id)).toEqual(["b"]);
    expect(homeSections(apps, (id) => (id === "e-t" ? { kind: "detached" } : stopped)).running.map((a) => a.id)).toEqual(["e"]);
  });
  it("an app can be in several sections", () => {
    const s = homeSections([app("a", { favourite: true, lastOpened: 5 })], () => running);
    expect([s.favourites.length, s.recent.length, s.running.length]).toEqual([1, 1, 1]);
  });
  it("a console that is running also counts as running", () => {
    const s = homeSections([app("a")], (id) => (id === consoleId("a") ? running : stopped));
    expect(s.running.map((a) => a.id)).toEqual(["a"]);
  });
});

describe("git helpers", () => {
  const info = (o: Partial<RepoInfo> = {}): RepoInfo => ({
    toplevel: "C:\\r", branch: "main", detached: false, head: "abc1234", dirty: false, hasUpstream: true, ahead: 0, behind: 0, ...o,
  });

  it("branchLabel covers branch, dirty, detached and unborn", () => {
    expect(branchLabel(info())).toBe("main");
    expect(branchLabel(info({ dirty: true }))).toBe("main ●");
    expect(branchLabel(info({ branch: null, detached: true }))).toBe("detached @ abc1234");
    expect(branchLabel(info({ branch: null, head: null }))).toBe("no commits yet");
    expect(branchLabel(info({ ahead: 2, behind: 1 }))).toBe("main ↑2 ↓1");
    expect(branchLabel(info({ dirty: true, ahead: 1 }))).toBe("main ● ↑1");
  });

  it("filterBranches is case-insensitive and keeps order", () => {
    expect(filterBranches(["main", "Feature/Login", "fix-login"], "LOGIN")).toEqual(["Feature/Login", "fix-login"]);
    expect(filterBranches(["a", "b"], "  ")).toEqual(["a", "b"]);
  });

  it("canCommit needs a message and at least one selected file, and no conflicts", () => {
    const files: FileChange[] = [
      { path: "a", status: "M", staged: false, conflict: false },
      { path: "b", status: "U", staged: false, conflict: true },
    ];
    expect(canCommit(["a"], "msg", files)).toEqual({ ok: true });
    expect(canCommit([], "msg", files).ok).toBe(false);
    expect(canCommit(["a"], "   ", files).ok).toBe(false);
    const c = canCommit(["b"], "msg", files);
    expect(c.ok).toBe(false);
    expect((c as { reason: string }).reason).toMatch(/conflict/i);
  });

  it("statusWord names the letters", () => {
    expect(statusWord("M")).toBe("modified");
    expect(statusWord("?")).toBe("new");
    expect(statusWord("D")).toBe("deleted");
    expect(statusWord("A")).toBe("added");
    expect(statusWord("R")).toBe("renamed");
    expect(statusWord("U")).toBe("conflict");
    expect(statusWord("Z")).toBe("changed");
  });
});

describe("graphRows (commit graph lanes)", () => {
  const c = (hash: string, parents: string[] = []): CommitInfo => ({
    hash, short: hash, parents, subject: hash, author: "x", date: 0, refs: [],
  });

  it("a straight history uses one lane", () => {
    const g = graphRows([c("c3", ["c2"]), c("c2", ["c1"]), c("c1")]);
    expect(g.maxLanes).toBe(1);
    expect(g.rows.map((r) => r.col)).toEqual([0, 0, 0]);
    expect(g.rows[0].before).toEqual([]);
    expect(g.rows[0].after).toEqual(["c2"]);
    expect(g.rows[2].after).toEqual([]);
  });

  it("a branch that is merged back opens a second lane and closes it", () => {
    // m merges f (feature) into main; both descend from base
    const g = graphRows([c("m", ["b2", "f"]), c("f", ["base"]), c("b2", ["base"]), c("base")]);
    expect(g.maxLanes).toBe(2);
    expect(g.rows[0].parentCols).toEqual([0, 1]);
    expect(g.rows[1].col).toBe(1); // f sits in the second lane
    expect(g.rows[2].col).toBe(0);
    expect(g.rows[2].parentCols).toEqual([1]); // b2 joins the lane already waiting for base
    expect(g.rows[3].col).toBe(1);
    expect(g.rows[3].before.filter(Boolean)).toEqual(["base"]); // lanes converged on base
    expect(g.rows[3].after).toEqual([]);
  });

  it("two independent tips each get a lane", () => {
    const g = graphRows([c("t1", ["p"]), c("t2", ["p"]), c("p")]);
    expect(g.rows[0].col).toBe(0);
    expect(g.rows[1].col).toBe(1);
    expect(g.rows[2].col).toBe(0);
    expect(g.maxLanes).toBe(2);
  });

  it("parents outside the loaded window keep one shared lane", () => {
    const g = graphRows([c("a", ["gone"]), c("b", ["gone"])]);
    expect(g.rows[1].col).toBe(1);
    expect(g.rows[1].parentCols).toEqual([0]);
    expect(g.rows[1].after).toEqual(["gone"]);
  });

  it("empty input is fine", () => {
    expect(graphRows([])).toEqual({ rows: [], maxLanes: 0 });
  });
});
