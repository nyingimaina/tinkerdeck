import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BranchMenu } from "./BranchMenu";
import { ChangesView } from "./ChangesView";
import { GitBar } from "./GitBar";
import { GitDrawer } from "./GitDrawer";
import { HistoryView } from "./HistoryView";
import type { CommitInfo, FileChange, RepoInfo } from "../../state/git";
import type { GitController } from "../../state/useGit";

vi.mock("../../api/tauri", () => ({ api: {}, errorText: (e: unknown) => String(e) }));

const info = (o: Partial<RepoInfo> = {}): RepoInfo => ({
  toplevel: "C:\\r", branch: "main", detached: false, head: "abc1234", dirty: false, hasUpstream: true, ahead: 1, behind: 2, ...o,
});

const controller = (o: Partial<GitController> = {}): GitController => ({
  info: info(),
  busy: null,
  message: null,
  branches: { current: "main", local: ["main", "feature/login"], remote: ["release"] },
  changes: null,
  commits: null,
  refresh: vi.fn(async () => {}),
  watchBranches: vi.fn(),
  loadBranches: vi.fn(async () => {}),
  loadChanges: vi.fn(async () => {}),
  loadHistory: vi.fn(async () => {}),
  loadCommitFiles: vi.fn(async () => []),
  fetch: vi.fn(async () => {}),
  pull: vi.fn(async () => {}),
  push: vi.fn(async () => {}),
  sync: vi.fn(async () => {}),
  switchBranch: vi.fn(async () => true),
  commit: vi.fn(async () => true),
  dismiss: vi.fn(),
  ...o,
});

const bar = (git: GitController) => {
  const h = { onSwitch: vi.fn(), onOpenChanges: vi.fn(), onOpenHistory: vi.fn(), onOpenConsole: vi.fn() };
  render(<GitBar git={git} {...h} />);
  return h;
};

describe("GitBar", () => {
  it("renders nothing outside a repository and while loading", () => {
    const { container, rerender } = render(<GitBar git={controller({ info: null })} onSwitch={vi.fn()} onOpenChanges={vi.fn()} onOpenHistory={vi.fn()} onOpenConsole={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<GitBar git={controller({ info: undefined })} onSwitch={vi.fn()} onOpenChanges={vi.fn()} onOpenHistory={vi.fn()} onOpenConsole={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows branch, dirty marker and ahead/behind", () => {
    bar(controller({ info: info({ dirty: true }) }));
    expect(screen.getByRole("button", { name: /Switch branch, current main/ })).toHaveTextContent("main ●");
    expect(screen.getByLabelText("Ahead and behind")).toHaveTextContent("↑1 ↓2");
  });

  it("says when there is no upstream and disables Pull (push still works: it sets the upstream)", () => {
    bar(controller({ info: info({ hasUpstream: false }) }));
    expect(screen.getByLabelText("Ahead and behind")).toHaveTextContent("no upstream");
    expect(screen.getByRole("button", { name: /Pull/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Push/ })).toBeEnabled();
  });

  it("on a detached HEAD shows the hash and disables pull, push and sync", () => {
    bar(controller({ info: info({ branch: null, detached: true }) }));
    expect(screen.getByRole("button", { name: /Switch branch/ })).toHaveTextContent("detached @ abc1234");
    for (const n of [/Pull/, /Push/, /Sync/]) expect(screen.getByRole("button", { name: n })).toBeDisabled();
  });

  it("buttons call the controller", async () => {
    const git = controller();
    bar(git);
    await userEvent.click(screen.getByRole("button", { name: "Fetch" }));
    await userEvent.click(screen.getByRole("button", { name: /Pull/ }));
    await userEvent.click(screen.getByRole("button", { name: /Push/ }));
    await userEvent.click(screen.getByRole("button", { name: /Sync/ }));
    expect([git.fetch, git.pull, git.push, git.sync].map((f) => (f as ReturnType<typeof vi.fn>).mock.calls.length)).toEqual([1, 1, 1, 1]);
  });

  it("R6: the refresh control no longer tells the user F5 refreshes", () => {
    render(
      <GitBar
        git={controller()}
        onSwitch={vi.fn()}
        onOpenChanges={vi.fn()}
        onOpenHistory={vi.fn()}
        onOpenConsole={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    const refresh = screen.getByRole("button", { name: "Refresh" });
    expect(refresh).toHaveAttribute("title", "Refresh now");
    expect(refresh.getAttribute("title")).not.toContain("F5");
  });

  it("disables everything while an operation runs and shows its name", () => {
    bar(controller({ busy: "Pull" }));
    for (const n of [/Fetch/, /Pull/, /Push/, /Sync/, /Switch branch/]) expect(screen.getByRole("button", { name: n })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Pull…");
  });

  it("shows errors verbatim as an alert and can dismiss them", async () => {
    const git = controller({ message: { kind: "error", text: "error: Your local changes would be overwritten by checkout" } });
    bar(git);
    expect(screen.getByRole("alert")).toHaveTextContent("Your local changes would be overwritten by checkout");
    await userEvent.click(screen.getByRole("button", { name: "Dismiss message" }));
    expect(git.dismiss).toHaveBeenCalled();
  });

  it("opens the branch menu (loading branches) and reports the chosen branch to the parent", async () => {
    const git = controller();
    const h = bar(git);
    await userEvent.click(screen.getByRole("button", { name: /Switch branch/ }));
    expect(git.loadBranches).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "feature/login" }));
    expect(h.onSwitch).toHaveBeenCalledWith("feature/login");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("links to changes, history and the console", async () => {
    const h = bar(controller({ info: info({ dirty: true }) }));
    await userEvent.click(screen.getByRole("button", { name: /Changes/ }));
    await userEvent.click(screen.getByRole("button", { name: "History" }));
    await userEvent.click(screen.getByRole("button", { name: /Console/ }));
    expect([h.onOpenChanges, h.onOpenHistory, h.onOpenConsole].every((f) => f.mock.calls.length === 1)).toBe(true);
  });
});

describe("BranchMenu", () => {
  const branches = { current: "main", local: ["main", "feature/login", "fix-login"], remote: ["release", "login-v2"] };
  const menu = () => within(screen.getByRole("dialog", { name: "Switch branch" }));

  it("A4: marks the current branch, disables it, and offers remote branches separately", async () => {
    const onPick = vi.fn();
    render(<BranchMenu branches={branches} onPick={onPick} onClose={vi.fn()} />);
    expect(menu().getByRole("button", { name: /✓ main/ })).toBeDisabled();
    expect(menu().getByText(/On the remote/)).toBeInTheDocument();
    await userEvent.click(menu().getByRole("button", { name: /release/ }));
    expect(onPick).toHaveBeenCalledWith("release");
  });

  it("A4: filters both lists as you type", async () => {
    render(<BranchMenu branches={branches} onPick={vi.fn()} onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Filter branches"), "LOGIN");
    expect(menu().getAllByRole("button").map((b) => b.textContent)).toEqual(["feature/login", "fix-login", "⇣ login-v2"]);
    await userEvent.type(screen.getByLabelText("Filter branches"), "zzz");
    expect(menu().getByText("No branch matches.")).toBeInTheDocument();
  });

  it("A4: the filter box is focused and Escape closes the menu", async () => {
    const onClose = vi.fn();
    render(<BranchMenu branches={branches} onPick={vi.fn()} onClose={onClose} />);
    expect(screen.getByLabelText("Filter branches")).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("A4: shows loading until branches arrive", () => {
    render(<BranchMenu branches={null} onPick={vi.fn()} onClose={vi.fn()} />);
    expect(menu().getByText("Loading…")).toBeInTheDocument();
  });

  it("R8/A3: the branch menu is a side pane whose named close control closes it", async () => {
    const onClose = vi.fn();
    render(<BranchMenu branches={branches} onPick={vi.fn()} onClose={onClose} />);
    expect(document.querySelector('[class*="ZestResponsiveLayout-module_sidePane"]')).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Close Switch branch" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ChangesView", () => {
  const files: FileChange[] = [
    { path: "src/a.ts", status: "M", staged: false, conflict: false },
    { path: "new file.txt", status: "?", staged: false, conflict: false },
    { path: "gone.txt", status: "D", staged: true, conflict: false },
  ];

  it("says so when clean and while loading", () => {
    const { rerender } = render(<ChangesView files={[]} busy={false} onCommit={vi.fn()} />);
    expect(screen.getByText(/Nothing to commit/)).toBeInTheDocument();
    rerender(<ChangesView files={null} busy={false} onCommit={vi.fn()} />);
    expect(screen.getByText(/Loading changes/)).toBeInTheDocument();
  });

  it("selects everything by default, needs a message, then commits exactly the selected files", async () => {
    const onCommit = vi.fn(async () => true);
    render(<ChangesView files={files} busy={false} onCommit={onCommit} />);
    expect(screen.getByText("3 of 3 selected")).toBeInTheDocument();
    const commit = screen.getByRole("button", { name: "Commit 3 files" });
    expect(commit).toBeDisabled();
    expect(screen.getByText("Write a commit message.")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("new file.txt")); // untick one
    await userEvent.type(screen.getByLabelText("Commit message"), "fix: things");
    await userEvent.click(screen.getByRole("button", { name: "Commit 2 files" }));
    expect(onCommit).toHaveBeenCalledWith(["src/a.ts", "gone.txt"], "fix: things");
    await waitFor(() => expect(screen.getByLabelText("Commit message")).toHaveValue(""));
  });

  it("keeps the message when the commit fails", async () => {
    render(<ChangesView files={files} busy={false} onCommit={vi.fn(async () => false)} />);
    await userEvent.type(screen.getByLabelText("Commit message"), "keep me");
    await userEvent.click(screen.getByRole("button", { name: "Commit 3 files" }));
    expect(screen.getByLabelText("Commit message")).toHaveValue("keep me");
  });

  it("select all toggles, and with nothing selected explains", async () => {
    render(<ChangesView files={files} busy={false} onCommit={vi.fn()} />);
    await userEvent.click(screen.getByLabelText(/3 of 3 selected/));
    expect(screen.getByText("0 of 3 selected")).toBeInTheDocument();
    expect(screen.getByText("Select at least one file.")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/0 of 3 selected/));
    expect(screen.getByText("3 of 3 selected")).toBeInTheDocument();
  });

  it("conflicted files start unselected and block the commit if picked", async () => {
    const withConflict: FileChange[] = [...files, { path: "c.txt", status: "U", staged: false, conflict: true }];
    render(<ChangesView files={withConflict} busy={false} onCommit={vi.fn()} />);
    expect(screen.getByText("3 of 4 selected")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Commit message"), "m");
    await userEvent.click(screen.getByLabelText("c.txt"));
    expect(screen.getByText(/conflict/i, { selector: "p" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Commit 4 files/ })).toBeDisabled();
  });

  it("is disabled while another git operation runs", async () => {
    render(<ChangesView files={files} busy={true} onCommit={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Commit message"), "m");
    expect(screen.getByRole("button", { name: /Commit 3 files/ })).toBeDisabled();
  });
});

describe("HistoryView", () => {
  const c = (hash: string, parents: string[], subject: string, refs: string[] = []): CommitInfo => ({
    hash, short: hash.slice(0, 7), parents, subject, author: "Nyingi", date: Math.floor(Date.now() / 1000) - 7200, refs,
  });

  it("lists commits with refs, author and relative time", () => {
    render(<HistoryView commits={[c("bbbbbbb1", ["aaaaaaa1"], "second", ["main", "tag: v1"]), c("aaaaaaa1", [], "first")]} loadFiles={vi.fn(async () => [])} />);
    const rows = within(screen.getByRole("list", { name: "Commit history" })).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("second");
    expect(rows[0]).toHaveTextContent("main");
    expect(rows[0]).toHaveTextContent("tag: v1");
    expect(rows[0]).toHaveTextContent("Nyingi · 2h ago");
  });

  it("draws one svg dot per commit", () => {
    const { container } = render(<HistoryView commits={[c("b1", ["a1"], "two"), c("a1", [], "one")]} loadFiles={vi.fn(async () => [])} />);
    expect(container.querySelectorAll("circle")).toHaveLength(2);
  });

  it("opens a commit to show its files, loading them once", async () => {
    const loadFiles = vi.fn(async () => [{ status: "M", path: "src/x.ts" }, { status: "A", path: "y.txt" }]);
    render(<HistoryView commits={[c("abc1234", [], "init")]} loadFiles={loadFiles} />);
    const row = screen.getByRole("button", { name: /init/ });
    await userEvent.click(row);
    expect(await screen.findByText("src/x.ts")).toBeInTheDocument();
    expect(screen.getByText("y.txt")).toBeInTheDocument();
    await userEvent.click(row); // collapse
    expect(screen.queryByText("src/x.ts")).toBeNull();
    await userEvent.click(row); // expand again: cached
    expect(loadFiles).toHaveBeenCalledTimes(1);
  });

  it("copes with loading, empty and failing file lists", async () => {
    const { rerender } = render(<HistoryView commits={null} loadFiles={vi.fn()} />);
    expect(screen.getByText("Loading history…")).toBeInTheDocument();
    rerender(<HistoryView commits={[]} loadFiles={vi.fn()} />);
    expect(screen.getByText("No commits yet.")).toBeInTheDocument();
    rerender(<HistoryView commits={[c("abc1234", [], "init")]} loadFiles={vi.fn(async () => { throw new Error("x"); })} />);
    await userEvent.click(screen.getByRole("button", { name: /init/ }));
    expect(await screen.findByText("Could not read the files.")).toBeInTheDocument();
  });
});

describe("GitDrawer", () => {
  it("loads the data of the selected tab and switches tabs", async () => {
    const git = controller({ changes: [], commits: [] });
    const onTab = vi.fn();
    const { rerender } = render(<GitDrawer git={git} tab="changes" onTab={onTab} onClose={vi.fn()} />);
    await waitFor(() => expect(git.loadChanges).toHaveBeenCalled());
    expect(git.loadHistory).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("tab", { name: "History" }));
    expect(onTab).toHaveBeenCalledWith("history");
    rerender(<GitDrawer git={git} tab="history" onTab={onTab} onClose={vi.fn()} />);
    await waitFor(() => expect(git.loadHistory).toHaveBeenCalled());
    expect(screen.getByText("No commits yet.")).toBeInTheDocument();
  });

  it("closes", async () => {
    const onClose = vi.fn();
    render(<GitDrawer git={controller({ changes: [] })} tab="changes" onTab={vi.fn()} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Close git panel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
