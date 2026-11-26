import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/editor", () => ({
  editorApi: {
    list: vi.fn(),
    open: vi.fn(),
    newDoc: vi.fn(),
    load: vi.fn(),
    snapshot: vi.fn(),
    save: vi.fn(),
    close: vi.fn(),
    restore: vi.fn(),
    discard: vi.fn(),
    takePending: vi.fn(),
    touch: vi.fn(),
    pickOpenPaths: vi.fn(),
    pickSavePath: vi.fn(),
    onOpen: vi.fn(),
  },
}));

import { editorApi } from "../api/editor";
import { useEditor, type EditorController } from "./useEditor";

const m = editorApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

const entry = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  path: `C:/x/${id}.txt`,
  title: `${id}.txt`,
  dirty: false,
  eol: "lf",
  encoding: "utf-8",
  lastUsed: 1,
  binnedAt: null,
  ...over,
});
const doc = (id: string, content: string, over: Record<string, unknown> = {}) => ({
  id,
  path: `C:/x/${id}.txt`,
  title: `${id}.txt`,
  content,
  dirty: false,
  eol: "lf",
  encoding: "utf-8",
  ...over,
});

let ctl: { current: EditorController };
let openedCb: ((p: string) => void) | null;
const onOpened = vi.fn();

function Probe() {
  ctl.current = useEditor({ onOpened });
  return null;
}
const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const mount = async () => {
  render(<Probe />);
  await flush();
};

beforeEach(() => {
  vi.useFakeTimers();
  ctl = { current: undefined as unknown as EditorController };
  openedCb = null;
  onOpened.mockReset();
  for (const k of Object.keys(m)) m[k].mockReset();
  m.list.mockResolvedValue({ open: [], bin: [] });
  m.takePending.mockResolvedValue([]);
  m.snapshot.mockResolvedValue(undefined);
  m.close.mockResolvedValue(undefined);
  m.touch.mockResolvedValue(undefined);
  m.onOpen.mockImplementation(async (cb: (p: string) => void) => {
    openedCb = cb;
    return () => {};
  });
  try {
    localStorage.clear();
  } catch {
    /* none */
  }
});
afterEach(() => vi.useRealTimers());

describe("useEditor", () => {
  it("brings back the editors from last time and loads the one in front", async () => {
    m.list.mockResolvedValue({ open: [entry("a"), entry("b", { dirty: true })], bin: [] });
    m.load.mockImplementation(async (id: string) => doc(id, id === "a" ? "alpha" : "beta draft", { dirty: id === "b" }));
    await mount();
    expect(ctl.current.tabs.map((t) => t.title)).toEqual(["a.txt", "b.txt"]);
    expect(ctl.current.tabs[1].dirty).toBe(true);
    expect(ctl.current.activeId).toBe("a");
    expect(ctl.current.active?.content).toBe("alpha");
    await act(async () => ctl.current.select("b"));
    await flush();
    expect(ctl.current.active?.content).toBe("beta draft");
  });

  it("snapshots unsaved typing after a quiet moment, once, with the latest text", async () => {
    m.list.mockResolvedValue({ open: [entry("a")], bin: [] });
    m.load.mockResolvedValue(doc("a", "alpha"));
    await mount();
    act(() => ctl.current.setContent("a", "alpha1"));
    await flush(300);
    act(() => ctl.current.setContent("a", "alpha12"));
    await flush(500);
    expect(m.snapshot).not.toHaveBeenCalled();
    await flush(400);
    expect(m.snapshot).toHaveBeenCalledTimes(1);
    expect(m.snapshot).toHaveBeenCalledWith("a", "alpha12");
    expect(ctl.current.tabs[0].dirty).toBe(true);
  });

  it("saves in place and clears the unsaved mark", async () => {
    m.list.mockResolvedValue({ open: [entry("a")], bin: [] });
    m.load.mockResolvedValue(doc("a", "alpha"));
    m.save.mockResolvedValue(doc("a", "alpha!"));
    await mount();
    act(() => ctl.current.setContent("a", "alpha!"));
    await act(async () => ctl.current.save("a"));
    expect(m.save).toHaveBeenCalledWith("a", "alpha!", null);
    expect(ctl.current.tabs[0].dirty).toBe(false);
    await flush(2000);
    expect(m.snapshot).not.toHaveBeenCalled(); // nothing left to snapshot after saving
  });

  it("asks where to save a new document, and does nothing if the dialog is cancelled", async () => {
    m.newDoc.mockResolvedValue(doc("n", "", { path: null, title: "new 1" }));
    m.pickSavePath.mockResolvedValueOnce(null).mockResolvedValueOnce("C:/x/notes.md");
    m.save.mockResolvedValue(doc("n", "hi", { path: "C:/x/notes.md", title: "notes.md" }));
    await mount();
    await act(async () => ctl.current.newDoc());
    act(() => ctl.current.setContent("n", "hi"));
    await act(async () => ctl.current.save("n"));
    expect(m.save).not.toHaveBeenCalled();
    await act(async () => ctl.current.save("n"));
    expect(m.save).toHaveBeenCalledWith("n", "hi", "C:/x/notes.md");
    expect(ctl.current.tabs[0].title).toBe("notes.md");
  });

  it("closing keeps unsaved text: it is snapshotted first, then the tab goes and the bin refreshes", async () => {
    m.list.mockResolvedValueOnce({ open: [entry("a")], bin: [] });
    m.load.mockResolvedValue(doc("a", "alpha"));
    await mount();
    act(() => ctl.current.setContent("a", "precious"));
    m.list.mockResolvedValue({ open: [], bin: [entry("a", { dirty: true, binnedAt: 5 })] });
    await act(async () => ctl.current.close("a"));
    expect(m.snapshot).toHaveBeenCalledWith("a", "precious");
    expect(m.close).toHaveBeenCalledWith("a");
    expect(ctl.current.tabs).toEqual([]);
    expect(ctl.current.bin.map((b) => b.id)).toEqual(["a"]);
  });

  it("opens files named on the command line at start and while running", async () => {
    m.takePending.mockResolvedValue(["C:/x/one.txt"]);
    m.open.mockImplementation(async (p: string) => doc(p.includes("one") ? "one" : "two", "text"));
    await mount();
    expect(m.open).toHaveBeenCalledWith("C:/x/one.txt");
    expect(onOpened).toHaveBeenCalledTimes(1);
    await act(async () => openedCb?.("C:/x/two.txt"));
    expect(ctl.current.tabs.map((t) => t.id)).toEqual(["one", "two"]);
    expect(ctl.current.activeId).toBe("two");
    expect(onOpened).toHaveBeenCalledTimes(2);
  });

  it("opening a file that is already open just brings its tab forward", async () => {
    m.open.mockResolvedValue(doc("a", "text"));
    await mount();
    await act(async () => ctl.current.openPath("C:/x/a.txt"));
    await act(async () => ctl.current.openPath("C:/x/a.txt"));
    expect(ctl.current.tabs).toHaveLength(1);
  });

  it("restores from the bin and can discard for good", async () => {
    m.list.mockResolvedValue({ open: [], bin: [entry("old", { dirty: true, binnedAt: 1 }), entry("older", { binnedAt: 1 })] });
    m.restore.mockResolvedValue(doc("old", "my draft", { dirty: true }));
    m.discard.mockResolvedValue(undefined);
    await mount();
    expect(ctl.current.bin).toHaveLength(2);
    m.list.mockResolvedValue({ open: [], bin: [entry("older", { binnedAt: 1 })] });
    await act(async () => ctl.current.restore("old"));
    expect(ctl.current.tabs.map((t) => t.id)).toEqual(["old"]);
    expect(ctl.current.active?.content).toBe("my draft");
    m.list.mockResolvedValue({ open: [], bin: [] });
    await act(async () => ctl.current.discard("older"));
    expect(m.discard).toHaveBeenCalledWith("older");
    expect(ctl.current.bin).toEqual([]);
  });

  it("shows a plain message when a remembered file has gone, instead of crashing", async () => {
    m.list.mockResolvedValue({ open: [entry("gone")], bin: [] });
    m.load.mockRejectedValue("The file was not found: C:/x/gone.txt");
    await mount();
    expect(ctl.current.active?.error).toContain("not found");
  });

  it("flushes pending typing at once when the window is hidden", async () => {
    m.list.mockResolvedValue({ open: [entry("a")], bin: [] });
    m.load.mockResolvedValue(doc("a", "alpha"));
    await mount();
    act(() => ctl.current.setContent("a", "typed"));
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(m.snapshot).toHaveBeenCalledWith("a", "typed");
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });
});

describe("explorer file operations keep the editor in step (R9)", () => {
  it("R9: flushPending sends the latest typing at once and waits for the snapshot", async () => {
    m.list.mockResolvedValue({ open: [entry("a")], bin: [] });
    m.load.mockResolvedValue(doc("a", "alpha"));
    await mount();
    let release: () => void = () => {};
    m.snapshot.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    act(() => ctl.current.setContent("a", "typed"));

    let done = false;
    await act(async () => {
      const pending = ctl.current.flushPending().then(() => {
        done = true;
      });
      await Promise.resolve();
      expect(m.snapshot).toHaveBeenCalledWith("a", "typed");
      expect(done).toBe(false);
      release();
      await pending;
    });
    expect(done).toBe(true);
    // The timer was cleared, so the quiet moment cannot send the same text a second time.
    await flush(2000);
    expect(m.snapshot).toHaveBeenCalledTimes(1);
  });

  it("R9: applyRepaths re-points a tab to its new path and title and keeps its unsaved text", async () => {
    m.list.mockResolvedValue({ open: [entry("a")], bin: [] });
    m.load.mockResolvedValue(doc("a", "alpha"));
    await mount();
    act(() => ctl.current.setContent("a", "a draft"));

    act(() => ctl.current.applyRepaths([{ id: "a", path: "C:/x/lib/b.txt", title: "b.txt" }]));

    const tab = ctl.current.tabs[0];
    expect(tab).toMatchObject({ id: "a", path: "C:/x/lib/b.txt", title: "b.txt", dirty: true });
    expect(ctl.current.active?.content).toBe("a draft");
  });

  it("R9: applyRepaths ignores a tab that is not open", async () => {
    m.list.mockResolvedValue({ open: [entry("a")], bin: [] });
    m.load.mockResolvedValue(doc("a", "alpha"));
    await mount();
    act(() => ctl.current.applyRepaths([{ id: "other", path: "C:/x/z.txt", title: "z.txt" }]));
    expect(ctl.current.tabs.map((t) => t.title)).toEqual(["a.txt"]);
  });

  it("R9: applyClosed drops the closed tabs and reloads the bin without closing them again", async () => {
    m.list.mockResolvedValueOnce({ open: [entry("a"), entry("b")], bin: [] });
    m.load.mockImplementation(async (id: string) => doc(id, id));
    await mount();
    expect(ctl.current.activeId).toBe("a");

    m.list.mockResolvedValue({ open: [entry("b")], bin: [entry("a", { dirty: true, binnedAt: 5 })] });
    act(() => ctl.current.applyClosed(["a"]));
    await flush();

    expect(ctl.current.tabs.map((t) => t.id)).toEqual(["b"]);
    expect(ctl.current.activeId).toBe("b");
    expect(ctl.current.bin.map((b) => b.id)).toEqual(["a"]);
    expect(m.close).not.toHaveBeenCalled();
  });

  it("R9: dirtyTitlesUnder lists only open tabs with unsaved text at or under the folder", async () => {
    m.list.mockResolvedValue({
      open: [
        entry("a", { path: "C:/x/lib/a.ts", title: "a.ts" }),
        entry("b", { path: "C:/x/lib/b.ts", title: "b.ts" }),
        entry("c", { path: "C:/x/other/c.ts", title: "c.ts" }),
        entry("d", { path: "C:/x/lib2/d.ts", title: "d.ts" }),
        entry("n", { path: null, title: "Untitled" }),
      ],
      bin: [],
    });
    m.load.mockImplementation(async (id: string) => doc(id, id, { path: "C:/x/lib/a.ts", title: "a.ts" }));
    await mount();
    act(() => {
      ctl.current.setContent("a", "edited");
      ctl.current.setContent("c", "edited");
      ctl.current.setContent("d", "edited");
    });

    expect(ctl.current.dirtyTitlesUnder("C:/x/lib")).toEqual(["a.ts"]);
  });
});
