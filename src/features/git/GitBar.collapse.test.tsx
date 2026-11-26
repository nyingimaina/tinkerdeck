import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RepoInfo } from "../../state/git";
import type { GitController } from "../../state/useGit";
import { GitBar } from "./GitBar";

vi.mock("../../api/tauri", () => ({ api: {}, errorText: (e: unknown) => String(e) }));

const info = (o: Partial<RepoInfo> = {}): RepoInfo => ({
  toplevel: "C:\\r", branch: "main", detached: false, head: "abc1234", dirty: false, hasUpstream: true, ahead: 1, behind: 2, ...o,
});

const controller = (o: Partial<GitController> = {}): GitController => ({
  info: info(),
  busy: null,
  message: null,
  branches: null,
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

const handlers = () => ({ onSwitch: vi.fn(), onOpenChanges: vi.fn(), onOpenHistory: vi.fn(), onOpenConsole: vi.fn(), onRefresh: vi.fn() });

const toolNames = [/Fetch/, /Pull/, /Push/, /Sync/, /Changes/, /History/, /Console/];

describe("GitBar branch chip", () => {
  it("R5: starts collapsed when asked, keeping branch, dirty marker, ahead/behind and refresh visible", () => {
    render(<GitBar git={controller({ info: info({ dirty: true }) })} {...handlers()} collapsible defaultCollapsed />);

    const pill = screen.getByRole("button", { name: /Switch branch, current main/ });
    expect(pill).toHaveTextContent("main");
    expect(pill.textContent?.length).toBeGreaterThan("main".length);
    expect(screen.getByLabelText("Ahead and behind")).toHaveTextContent(/1\D+2/);
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show git tools" })).toHaveAttribute("aria-expanded", "false");

    for (const name of toolNames) expect(screen.queryByRole("button", { name })).toBeNull();
  });

  it("R5: the chip control expands the tools and collapses them back to the same state", async () => {
    render(<GitBar git={controller()} {...handlers()} collapsible defaultCollapsed />);

    await userEvent.click(screen.getByRole("button", { name: "Show git tools" }));
    expect(screen.getByRole("button", { name: "Hide git tools" })).toHaveAttribute("aria-expanded", "true");
    for (const name of toolNames) expect(screen.getByRole("button", { name })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Hide git tools" }));
    expect(screen.getByRole("button", { name: "Show git tools" })).toHaveAttribute("aria-expanded", "false");
    for (const name of toolNames) expect(screen.queryByRole("button", { name })).toBeNull();
  });

  it("A5: existing callers still get the full tools expanded, so no control changes behaviour", () => {
    render(<GitBar git={controller()} {...handlers()} />);
    for (const name of toolNames) expect(screen.getByRole("button", { name })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show git tools" })).toBeNull();
  });

  it("R5: a collapsed chip stays out of the way outside a repository", () => {
    const { container } = render(<GitBar git={controller({ info: null })} {...handlers()} collapsible defaultCollapsed />);
    expect(container).toBeEmptyDOMElement();
  });

  it("A1: the chip still expands and collapses the tools for an uncontrolled caller", async () => {
    render(<GitBar git={controller()} {...handlers()} collapsible defaultCollapsed />);

    await userEvent.click(screen.getByRole("button", { name: "Show git tools" }));
    expect(screen.getByRole("button", { name: "Hide git tools" })).toHaveAttribute("aria-expanded", "true");
    for (const name of toolNames) expect(screen.getByRole("button", { name })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Hide git tools" }));
    expect(screen.getByRole("button", { name: "Show git tools" })).toHaveAttribute("aria-expanded", "false");
    for (const name of toolNames) expect(screen.queryByRole("button", { name })).toBeNull();
  });

  it("R8: a controlled caller collapses the tools from the chip and decides the new state", async () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <GitBar git={controller()} {...handlers()} collapsible open onOpenChange={onOpenChange} />,
    );
    expect(screen.getByRole("button", { name: "Hide git tools" })).toHaveAttribute("aria-expanded", "true");
    for (const name of toolNames) expect(screen.getByRole("button", { name })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Hide git tools" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // still open until the parent applies the new state
    expect(screen.getByRole("button", { name: /Fetch/ })).toBeInTheDocument();

    rerender(<GitBar git={controller()} {...handlers()} collapsible open={false} onOpenChange={onOpenChange} />);
    const chip = screen.getByRole("button", { name: "Show git tools" });
    expect(chip).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /Switch branch, current main/ })).toBeInTheDocument();
    for (const name of toolNames) expect(screen.queryByRole("button", { name })).toBeNull();
  });
});
