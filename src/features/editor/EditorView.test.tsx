import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loaded = vi.hoisted(() => ({ count: 0 }));
vi.mock("./CodeSurface", () => {
  loaded.count += 1;
  return { default: (p: { docId: string; value: string }) => <div data-testid="surface">{p.docId}:{p.value}</div> };
});

import { EditorView } from "./EditorView";
import type { EditorController } from "../../state/useEditor";

const now = Math.floor(Date.now() / 1000);
const tab = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `${id}.txt`,
  path: `C:/x/${id}.txt`,
  dirty: false,
  eol: "lf",
  encoding: "utf-8",
  ...over,
});

function controller(over: Partial<EditorController> = {}): EditorController {
  return {
    ready: true,
    tabs: [tab("a"), tab("b", { dirty: true })],
    activeId: "a",
    active: { content: "alpha", loaded: true, error: null },
    bin: [],
    error: null,
    select: vi.fn(),
    setContent: vi.fn(),
    openPath: vi.fn(),
    openDialog: vi.fn(),
    newDoc: vi.fn(),
    save: vi.fn(),
    saveAs: vi.fn(),
    close: vi.fn(),
    restore: vi.fn(),
    discard: vi.fn(),
    dismissError: vi.fn(),
    ...over,
  } as unknown as EditorController;
}

beforeEach(() => {
  loaded.count = 0;
});

describe("EditorView", () => {
  it("loads the heavy editor only when it is first shown", async () => {
    expect(loaded.count).toBe(0);
    render(<EditorView editor={controller()} theme="light" />);
    await waitFor(() => expect(screen.getByTestId("surface")).toBeTruthy());
    expect(loaded.count).toBe(1);
    expect(screen.getByTestId("surface").textContent).toBe("a:alpha");
  });

  it("shows a tab per editor, marks unsaved ones, and switches on click", async () => {
    const c = controller();
    render(<EditorView editor={c} theme="light" />);
    expect(screen.getByRole("tab", { name: /a\.txt/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("unsaved changes kept")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /b\.txt/ }));
    expect(c.select).toHaveBeenCalledWith("b");
    fireEvent.click(screen.getByLabelText("Close b.txt"));
    expect(c.close).toHaveBeenCalledWith("b");
  });

  it("has an empty state with New and Open when nothing is open", () => {
    const c = controller({ tabs: [], activeId: null, active: null });
    render(<EditorView editor={c} theme="light" />);
    fireEvent.click(screen.getByRole("button", { name: "New file" }));
    fireEvent.click(screen.getAllByRole("button", { name: /Open/ })[0]);
    expect(c.newDoc).toHaveBeenCalled();
    expect(c.openDialog).toHaveBeenCalled();
  });

  it("lists the bin with days left and lets you restore or delete for good", () => {
    const c = controller({
      bin: [{ id: "x", title: "draft.txt", path: null, dirty: true, eol: "lf", encoding: "utf-8", binnedAt: now - 3 * 86400 }] as never,
    });
    render(<EditorView editor={c} theme="light" />);
    fireEvent.click(screen.getByRole("button", { name: /Bin \(1\)/ }));
    expect(screen.getByText(/27 days left/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore draft.txt" }));
    expect(c.restore).toHaveBeenCalledWith("x");
    fireEvent.click(screen.getByRole("button", { name: "Delete draft.txt for good" }));
    expect(c.discard).toHaveBeenCalledWith("x");
  });

  it("saves with Ctrl+S and opens a new file with Ctrl+N", () => {
    const c = controller();
    render(<EditorView editor={c} theme="light" />);
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(c.save).toHaveBeenCalledWith("a");
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    expect(c.newDoc).toHaveBeenCalled();
  });

  it("shows a missing-file message with a way out", () => {
    const c = controller({ active: { content: "", loaded: true, error: "The file was not found: C:/x/a.txt" } as never });
    render(<EditorView editor={c} theme="light" />);
    expect(screen.getByText(/was not found/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close this tab" }));
    expect(c.close).toHaveBeenCalledWith("a");
  });

  it("reassures that nothing is lost and shows the file's line endings and encoding", () => {
    render(<EditorView editor={controller()} theme="light" />);
    expect(screen.getByText(/kept automatically/i)).toBeTruthy();
    expect(screen.getByText("Unix (LF)")).toBeTruthy();
    expect(screen.getByText("UTF-8")).toBeTruthy();
  });
});
