import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const loaded = vi.hoisted(() => ({ count: 0 }));
vi.mock("./CodeSurface", () => {
  loaded.count += 1;
  return { default: (p: { docId: string; value: string }) => <div data-testid="surface">{p.docId}:{p.value}</div> };
});
vi.mock("./PreviewPane", () => ({
  default: (p: { kind: string; content: string; path: string | null }) => (
    <div data-testid="preview">
      {p.kind}:{p.content}:{p.path ?? "-"}
    </div>
  ),
}));

import { EditorSurface } from "./EditorSurface";
import type { EditorController } from "../../state/useEditor";

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
    tabs: [tab("a")],
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

describe("EditorSurface", () => {
  it("R1: fetches the editor only when a file is on screen, then saves the active file", async () => {
    expect(loaded.count).toBe(0);
    const c = controller();
    render(<EditorSurface editor={c} theme="light" />);
    await waitFor(() => expect(screen.getByTestId("surface")).toBeTruthy());
    expect(loaded.count).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(c.save).toHaveBeenCalledWith("a");
    fireEvent.click(screen.getByRole("button", { name: "Save as…" }));
    expect(c.saveAs).toHaveBeenCalledWith("a");
  });

  it("R1: opening another file reuses the one editor surface instead of loading a second", async () => {
    const { rerender } = render(<EditorSurface editor={controller()} theme="light" />);
    await waitFor(() => expect(screen.getByTestId("surface")).toBeTruthy());
    const first = screen.getByTestId("surface");

    rerender(
      <EditorSurface
        editor={controller({ tabs: [tab("a"), tab("b")], activeId: "b", active: { content: "beta", loaded: true, error: null } })}
        theme="light"
      />,
    );

    expect(screen.getByTestId("surface")).toBe(first);
    expect(loaded.count).toBe(1);
  });

  it("R1: shows the too-large message and opens no editor, with a way to close the tab", () => {
    const c = controller({ active: { content: "", loaded: true, error: "The file is too large to edit (over 5 MB)." } });
    render(<EditorSurface editor={c} theme="light" />);
    expect(screen.getByText(/too large/)).toBeTruthy();
    expect(screen.queryByTestId("surface")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close this tab" }));
    expect(c.close).toHaveBeenCalledWith("a");
  });

  it("R2: a binary preview shows the render only and cannot be saved", async () => {
    const c = controller({
      tabs: [tab("i", { title: "logo.png", path: "C:/x/logo.png", encoding: "binary" })],
      activeId: "i",
      active: { content: "", loaded: true, error: null },
    });
    render(<EditorSurface editor={c} theme="light" />);
    expect((await screen.findByTestId("preview")).textContent).toBe("image::C:/x/logo.png");
    expect(screen.queryByTestId("surface")).toBeNull();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Save as…" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("R5: the surface draws no editor tab list and no owner grouping", () => {
    render(<EditorSurface editor={controller({ tabs: [tab("a"), tab("b")] })} theme="light" />);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.queryByText(/Open editors/)).toBeNull();
  });

  it("R1: markdown offers Raw and Preview and keeps the one editor mounted underneath", async () => {
    const c = controller({
      tabs: [tab("m", { title: "README.md", path: "C:/x/README.md" })],
      activeId: "m",
      active: { content: "# Hi", loaded: true, error: null },
    });
    render(<EditorSurface editor={c} theme="light" />);
    const surface = await screen.findByTestId("surface");

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect((await screen.findByTestId("preview")).textContent).toBe("markdown:# Hi:C:/x/README.md");
    expect((surface.parentElement as HTMLElement).style.display).toBe("none");

    fireEvent.click(screen.getByRole("button", { name: "Raw" }));
    expect(screen.queryByTestId("preview")).toBeNull();
    expect((surface.parentElement as HTMLElement).style.display).not.toBe("none");
    expect(screen.getByTestId("surface")).toBe(surface);
  });

  it("A1: hiding the surface for a terminal tab keeps the same editor mounted", async () => {
    const { rerender } = render(<EditorSurface editor={controller()} theme="light" />);
    const surface = await screen.findByTestId("surface");

    rerender(<EditorSurface editor={controller()} theme="light" hidden />);

    expect(screen.getByTestId("surface")).toBe(surface);
    const root = surface.closest('[data-hidden="true"]') as HTMLElement;
    expect(root.style.display).toBe("none");
  });
});
