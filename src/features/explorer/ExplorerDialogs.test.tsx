import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ExplorerEntry } from "../../api/explorer";
import { ExplorerDialogs, validateExplorerName, type ExplorerPrompt } from "./ExplorerDialogs";

const file = (name = "a.txt"): ExplorerEntry => ({ name, path: `C:\\proj\\${name}`, isDir: false, locked: false });
const folder = (name = "lib"): ExplorerEntry => ({ name, path: `C:\\proj\\${name}`, isDir: true, locked: false });

const dialog = () => screen.getByRole("dialog");
const props = (prompt: ExplorerPrompt | null, over: Partial<Parameters<typeof ExplorerDialogs>[0]> = {}) => ({
  prompt,
  busy: false,
  onSubmit: vi.fn(),
  onCancel: vi.fn(),
  ...over,
});

describe("validateExplorerName", () => {
  it("R9 accepts a normal Windows file name", () => {
    expect(validateExplorerName("notes.md")).toBeNull();
    expect(validateExplorerName("My folder 2")).toBeNull();
  });

  it("R9 refuses an empty, whitespace-only or padded name", () => {
    expect(validateExplorerName("")).toBe("A name is required.");
    expect(validateExplorerName("   ")).toBe("A name is required.");
    expect(validateExplorerName(" a.txt")).toBe("A name cannot start or end with a space.");
  });

  it("R9 refuses a too-long name", () => {
    expect(validateExplorerName("x".repeat(256))).toBe("A name can be at most 255 characters.");
  });

  it("R9 refuses Windows-invalid characters and a trailing dot", () => {
    expect(validateExplorerName('bad:name')).toBe('A name cannot contain any of < > : " / \\ | ? *.');
    expect(validateExplorerName("bad*name")).toBe('A name cannot contain any of < > : " / \\ | ? *.');
    expect(validateExplorerName("notes.")).toBe("A name cannot end with a dot.");
  });

  it("R9 refuses a Windows device name", () => {
    expect(validateExplorerName("CON")).toContain("reserved");
    expect(validateExplorerName("lpt1.txt")).toContain("reserved");
  });
});

describe("ExplorerDialogs", () => {
  it("R9: the create prompt names the new item and submits the typed name", async () => {
    const p = props({ kind: "create", parent: "C:\\proj", item: "file" });
    render(<ExplorerDialogs {...p} />);

    expect(within(dialog()).getByRole("heading", { name: "New file" })).toBeInTheDocument();
    const input = within(dialog()).getByLabelText("Name");
    expect(input).toHaveFocus();
    await userEvent.type(input, "new.txt");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Create" }));

    expect(p.onSubmit).toHaveBeenCalledWith("new.txt");
  });

  it("R9: a folder create prompt is titled New folder", () => {
    render(<ExplorerDialogs {...props({ kind: "create", parent: "C:\\proj", item: "folder" })} />);
    expect(within(dialog()).getByRole("heading", { name: "New folder" })).toBeInTheDocument();
  });

  it("R9: an empty name is refused with a message and nothing is sent", async () => {
    const p = props({ kind: "create", parent: "C:\\proj", item: "file" });
    render(<ExplorerDialogs {...p} />);

    await userEvent.click(within(dialog()).getByRole("button", { name: "Create" }));
    expect(within(dialog()).getByRole("alert")).toHaveTextContent("A name is required.");
    expect(p.onSubmit).not.toHaveBeenCalled();
  });

  it("R9: an invalid name is refused and the message clears when the user corrects it", async () => {
    const p = props({ kind: "create", parent: "C:\\proj", item: "file" });
    render(<ExplorerDialogs {...p} />);

    const input = within(dialog()).getByLabelText("Name");
    await userEvent.type(input, "bad:name");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Create" }));
    expect(within(dialog()).getByRole("alert")).toHaveTextContent('A name cannot contain any of < > : " / \\ | ? *.');
    expect(p.onSubmit).not.toHaveBeenCalled();

    await userEvent.clear(input);
    expect(within(dialog()).queryByRole("alert")).toBeNull();
  });

  it("R9: the rename prompt starts with the current name and submits the replacement", async () => {
    const p = props({ kind: "rename", entry: file("a.txt") });
    render(<ExplorerDialogs {...p} />);

    expect(within(dialog()).getByRole("heading", { name: "Rename" })).toBeInTheDocument();
    const input = within(dialog()).getByLabelText("Name") as HTMLInputElement;
    expect(input.value).toBe("a.txt");
    await userEvent.clear(input);
    await userEvent.type(input, "b.txt{Enter}");

    expect(p.onSubmit).toHaveBeenCalledWith("b.txt");
  });

  it("R9: the delete prompt names the item and says it goes to the Recycle Bin", async () => {
    const p = props({ kind: "delete", entry: file("a.txt"), dirtyTitles: [] });
    render(<ExplorerDialogs {...p} />);

    expect(within(dialog()).getByRole("heading", { name: "Delete a.txt?" })).toBeInTheDocument();
    expect(within(dialog()).getByText(/Recycle Bin/)).toBeInTheDocument();
    expect(within(dialog()).queryByText("Everything inside this folder goes with it.")).toBeNull();

    await userEvent.click(within(dialog()).getByRole("button", { name: "Delete" }));
    expect(p.onSubmit).toHaveBeenCalledWith("");
  });

  it("R9: a folder delete says everything inside goes with it and folds in the unsaved warning", () => {
    render(
      <ExplorerDialogs {...props({ kind: "delete", entry: folder("lib"), dirtyTitles: ["a.txt", "b.ts"] })} />,
    );

    const d = dialog();
    expect(within(d).getByText("Everything inside this folder goes with it.")).toBeInTheDocument();
    expect(within(d).getByText(/unsaved changes/)).toHaveTextContent("a.txt, b.ts");
    // One prompt only: the warning is folded in rather than asked afterwards (R9).
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("R9: a long unsaved list is summarised with and N more", () => {
    render(
      <ExplorerDialogs
        {...props({ kind: "delete", entry: folder("lib"), dirtyTitles: ["a", "b", "c", "d", "e"] })}
      />,
    );
    expect(within(dialog()).getByText(/unsaved changes/)).toHaveTextContent("a, b, c and 2 more");
  });

  it("R9: cancelling any prompt calls onCancel", async () => {
    const p = props({ kind: "rename", entry: file("a.txt") });
    render(<ExplorerDialogs {...p} />);
    await userEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(p.onCancel).toHaveBeenCalledTimes(1);
    expect(p.onSubmit).not.toHaveBeenCalled();
  });

  it("R9: while an operation is busy the prompt is disabled and cannot submit twice", async () => {
    const p = props({ kind: "delete", entry: file("a.txt"), dirtyTitles: [] }, { busy: true });
    render(<ExplorerDialogs {...p} />);

    const del = within(dialog()).getByRole("button", { name: /Deleting/ });
    await userEvent.click(del);
    expect(p.onSubmit).not.toHaveBeenCalled();
  });
});
