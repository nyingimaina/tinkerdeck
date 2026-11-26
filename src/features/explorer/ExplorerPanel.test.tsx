import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExplorerEntry, ExplorerListing } from "../../api/explorer";

const api = vi.hoisted(() => ({ list: vi.fn(), drives: vi.fn() }));
vi.mock("../../api/explorer", () => ({ explorerApi: api }));

const ed = vi.hoisted(() => ({
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
}));
vi.mock("../../api/editor", () => ({ editorApi: ed }));

import { ExplorerPanel } from "./ExplorerPanel";
import { useEditor } from "../../state/useEditor";

const ROOT = "C:\\proj";
const file = (name: string, dir = ROOT): ExplorerEntry => ({ name, path: `${dir}\\${name}`, isDir: false, locked: false });
const folder = (name: string, dir = ROOT, locked = false): ExplorerEntry => ({
  name,
  path: `${dir}\\${name}`,
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

const renderPanel = (props: Partial<Parameters<typeof ExplorerPanel>[0]> = {}) => {
  const onOpenFile = vi.fn();
  const view = render(<ExplorerPanel root={ROOT} source="app" onOpenFile={onOpenFile} {...props} />);
  return { onOpenFile, ...view };
};

beforeEach(() => {
  api.list.mockReset();
  api.drives.mockReset();
  api.list.mockImplementation(async (path: string) => listing(path));
  api.drives.mockResolvedValue([
    { name: "C:", path: "C:\\", isDir: true, locked: false },
    { name: "D:", path: "D:\\", isDir: true, locked: false },
  ]);
  for (const fn of Object.values(ed)) fn.mockReset();
  ed.list.mockResolvedValue({ open: [], bin: [] });
  ed.takePending.mockResolvedValue([]);
  ed.onOpen.mockResolvedValue(() => {});
});

describe("ExplorerPanel", () => {
  it("R2 lists one level and distinguishes folders from files", async () => {
    api.list.mockResolvedValue(listing(ROOT, [folder("src"), file("README.md")]));
    renderPanel();
    await flush();

    const dir = screen.getByTitle("C:\\proj\\src");
    expect(dir).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTitle("C:\\proj\\README.md")).not.toHaveAttribute("aria-expanded");
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it("R2 clicking a folder expands it, fetching its children only then, and clicking again collapses it", async () => {
    api.list.mockImplementation(async (path: string) =>
      path === ROOT ? listing(ROOT, [folder("src")]) : listing(path, [file("a.ts", path)]),
    );
    renderPanel();
    await flush();
    expect(api.list.mock.calls.filter((c) => c[0] === "C:\\proj\\src")).toHaveLength(0);

    await userEvent.click(screen.getByTitle("C:\\proj\\src"));
    await flush();
    expect(api.list).toHaveBeenCalledWith("C:\\proj\\src", false);
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    expect(screen.getByTitle("C:\\proj\\src")).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(screen.getByTitle("C:\\proj\\src"));
    expect(screen.queryByText("a.ts")).toBeNull();
    expect(screen.getByTitle("C:\\proj\\src")).toHaveAttribute("aria-expanded", "false");
  });

  it("R2 an empty folder expands without error and shows no children", async () => {
    api.list.mockImplementation(async (path: string) =>
      path === ROOT ? listing(ROOT, [folder("empty")]) : listing(path, []),
    );
    renderPanel();
    await flush();

    await userEvent.click(screen.getByTitle("C:\\proj\\empty"));
    await flush();
    expect(screen.getByText("Empty folder")).toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: /No such/ })).toBeNull();
  });

  it("R2 a large folder shows a loading indication while it reads", async () => {
    let release: (value: ExplorerListing) => void = () => {};
    const pending = new Promise<ExplorerListing>((resolve) => {
      release = resolve;
    });
    api.list.mockImplementation(async (path: string) => (path === ROOT ? listing(ROOT, [folder("many")]) : pending));
    renderPanel();
    await flush();

    await userEvent.click(screen.getByTitle("C:\\proj\\many"));
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");

    await act(async () => {
      release(listing("C:\\proj\\many", [file("one.txt", "C:\\proj\\many")]));
      await pending;
    });
    expect(screen.getByText("one.txt")).toBeInTheDocument();
  });

  it("R2 a folder that cannot be read shows as locked instead of throwing", async () => {
    api.list.mockImplementation(async (path: string) => {
      if (path === "C:\\proj\\secret") throw new Error("Access denied");
      return listing(ROOT, [folder("secret", ROOT, true)]);
    });
    renderPanel();
    await flush();
    expect(screen.getByLabelText("Locked folder")).toBeInTheDocument();

    await userEvent.click(screen.getByTitle("C:\\proj\\secret"));
    await flush();
    expect(screen.getByText(/This folder can't be read\./)).toBeInTheDocument();
  });

  it("R2 other dot-named files and folders are listed normally", async () => {
    api.list.mockResolvedValue(listing(ROOT, [file(".env"), file(".gitignore"), folder(".vscode")]));
    renderPanel();
    await flush();
    expect(screen.getByText(".env")).toBeInTheDocument();
    expect(screen.getByText(".gitignore")).toBeInTheDocument();
    expect(screen.getByText(".vscode")).toBeInTheDocument();
  });

  it("R2 Show hidden turns the hidden names on and off again", async () => {
    api.list.mockResolvedValue(listing(ROOT, []));
    renderPanel();
    await flush();

    await userEvent.click(screen.getByRole("button", { name: "Show hidden" }));
    await flush();
    expect(screen.getByRole("button", { name: "Hide hidden" })).toHaveAttribute("aria-pressed", "true");
    expect(api.list).toHaveBeenCalledWith(ROOT, true);

    await userEvent.click(screen.getByRole("button", { name: "Hide hidden" }));
    await flush();
    expect(screen.getByRole("button", { name: "Show hidden" })).toHaveAttribute("aria-pressed", "false");
    expect(api.list).toHaveBeenLastCalledWith(ROOT, false);
  });

  it("R3 clicking a file hands it to the editor's existing open path and never reads it as a folder", async () => {
    api.list.mockImplementation(async (path: string) =>
      path === ROOT ? listing(ROOT, [folder("src"), file("README.md")]) : listing(path, []),
    );
    const { onOpenFile } = renderPanel();
    await flush();

    await userEvent.click(screen.getByTitle("C:\\proj\\README.md"));
    expect(onOpenFile).toHaveBeenCalledWith("C:\\proj\\README.md");
    expect(api.list.mock.calls.some((c) => c[0] === "C:\\proj\\README.md")).toBe(false);
  });

  it("R3 a file that is already open still goes through the same single open path", async () => {
    api.list.mockResolvedValue(listing(ROOT, [file("README.md")]));
    const { onOpenFile } = renderPanel();
    await flush();

    await userEvent.click(screen.getByTitle("C:\\proj\\README.md"));
    await userEvent.click(screen.getByTitle("C:\\proj\\README.md"));
    expect(onOpenFile).toHaveBeenCalledTimes(2);
    expect(onOpenFile).toHaveBeenNthCalledWith(1, "C:\\proj\\README.md");
    expect(onOpenFile).toHaveBeenNthCalledWith(2, "C:\\proj\\README.md");
  });

  it("R3 clicking a folder only expands it and never opens it as a file", async () => {
    api.list.mockImplementation(async (path: string) =>
      path === ROOT ? listing(ROOT, [folder("src")]) : listing(path, [file("a.ts", path)]),
    );
    const { onOpenFile } = renderPanel();
    await flush();

    await userEvent.click(screen.getByTitle("C:\\proj\\src"));
    await flush();
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("R3 a click reaches the editor controller's openPath, the same editor_open_any the picker uses", async () => {
    api.list.mockResolvedValue(listing(ROOT, [file("README.md")]));
    ed.open.mockImplementation(async (path: string) => ({
      id: "d1",
      path,
      title: "README.md",
      content: "text",
      dirty: false,
      eol: "lf",
      encoding: "utf-8",
    }));

    function Harness() {
      const editor = useEditor();
      return <ExplorerPanel root={ROOT} source="app" onOpenFile={(path) => void editor.openPath(path)} />;
    }
    render(<Harness />);
    await flush();
    await userEvent.click(screen.getByTitle("C:\\proj\\README.md"));
    await waitFor(() => expect(ed.open).toHaveBeenCalledWith("C:\\proj\\README.md"));
    expect(ed.open).toHaveBeenCalledTimes(1);
    expect(ed.pickOpenPaths).not.toHaveBeenCalled(); // the explorer does not open a second picker
  });

  it("R5 a Misc root offers Up that climbs to the drive list", async () => {
    api.list.mockImplementation(async (path: string) => listing(path, path === "C:\\Users" ? [folder("me")] : []));
    renderPanel({ root: "C:\\Users", source: "misc" });
    await flush();

    await userEvent.click(screen.getByRole("button", { name: "Up" }));
    await flush();
    expect(api.list).toHaveBeenLastCalledWith("C:\\", false);

    await userEvent.click(screen.getByRole("button", { name: "Up" }));
    await flush();
    expect(screen.getByText("C:")).toBeInTheDocument();
    expect(screen.getByText("D:")).toBeInTheDocument();

    await userEvent.click(screen.getByText("C:"));
    await flush();
    expect(api.list).toHaveBeenLastCalledWith("C:\\", false);
  });

  it("R4 an app root offers no Up, so the top folder stays the app root", async () => {
    renderPanel({ root: ROOT, source: "app" });
    await flush();
    expect(screen.queryByRole("button", { name: "Up" })).toBeNull();
  });

  it("R4 switching the selected app or tab changes the root without touching any tab", async () => {
    api.list.mockImplementation(async (path: string) => listing(path, []));
    const { rerender } = render(<ExplorerPanel root={"C:\\a"} source="app" resetKey="app:a" onOpenFile={vi.fn()} />);
    await flush();
    expect(api.list).toHaveBeenLastCalledWith("C:\\a", false);

    rerender(<ExplorerPanel root={"D:\\b"} source="app" resetKey="app:b" onOpenFile={vi.fn()} />);
    await flush();
    expect(api.list).toHaveBeenLastCalledWith("D:\\b", false);
  });

  it("R4 if an app's root no longer exists it shows as locked instead of raising an error", async () => {
    api.list.mockRejectedValue(new Error("The folder does not exist"));
    renderPanel({ root: "C:\\gone", source: "app" });
    await flush();
    expect(screen.getByText(/This folder can't be read\./)).toBeInTheDocument();
  });

  it("A5 with no root it shows a hint and asks the core for nothing", async () => {
    const { rerender } = render(<ExplorerPanel root={null} onOpenFile={vi.fn()} />);
    await flush();
    expect(screen.getByText("Open an app or a file to browse its folder.")).toBeInTheDocument();
    expect(api.list).not.toHaveBeenCalled();
    expect(api.drives).not.toHaveBeenCalled();

    api.list.mockResolvedValue(listing(ROOT, [file("README.md")]));
    rerender(<ExplorerPanel root={ROOT} source="app" onOpenFile={vi.fn()} />);
    await flush();
    expect(screen.queryByText("Open an app or a file to browse its folder.")).toBeNull();
    expect(screen.getByText("README.md")).toBeInTheDocument();
  });

  it("A1 says when a level is truncated: Showing first 1000 of 1200", async () => {
    const entries = Array.from({ length: 1000 }, (_, i) => file(`f${i}.txt`));
    api.list.mockResolvedValue(listing(ROOT, entries, { total: 1200, truncated: true }));
    renderPanel();
    await flush();
    expect(screen.getByText("Showing first 1000 of 1200")).toBeInTheDocument();
  });
});
