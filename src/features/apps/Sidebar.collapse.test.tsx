import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import type { AppDef, TermState } from "../../state/model";

const apps: AppDef[] = [
  { id: "a1", name: "Qonsol", root: "E:\\q", terminals: [{ id: "t1", name: "api", cwd: ".", command: "", env: {} }] },
  { id: "a2", name: "pdfer", root: "E:\\p", terminals: [{ id: "t2", name: "web", cwd: ".", command: "", env: {} }] },
];
const up: TermState = { kind: "running" };
const stateOf = (id: string): TermState => (id === "t1" ? up : { kind: "stopped" });

const setup = (collapsed: boolean) => {
  const h = { onSelectApp: vi.fn(), onSelectTerminal: vi.fn(), onHome: vi.fn(), onTogglePane: vi.fn() };
  render(
    <Sidebar apps={apps} selectedAppId="a1" selectedTerminalId="t1" stateOf={stateOf} homeActive={false} paneCollapsed={collapsed} {...h} />,
  );
  return h;
};

describe("collapsible left pane", () => {
  it("expanded: shows names and a collapse button", async () => {
    const h = setup(false);
    expect(screen.getByRole("navigation", { name: "Apps" })).toBeInTheDocument();
    expect(screen.getByText("Qonsol")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(h.onTogglePane).toHaveBeenCalled();
  });

  it("A2: expanded keeps the Home row and app rows beside the new Projects | Files strip", () => {
    setup(false);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Projects" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Qonsol")).toBeInTheDocument();
    expect(screen.getByText("api")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Home/ })).toBeInTheDocument();
  });

  it("R3: the collapsed rail marks the active tab and leaves the other one inactive", () => {
    setup(true);
    expect(screen.getByRole("button", { name: "Projects" }).className).toContain("railOn");
    expect(screen.getByRole("button", { name: "Files" }).className).not.toContain("railOn");
  });

  it("collapsed: a narrow rail with expand, Home and one button per app with its status dot", async () => {
    const h = setup(true);
    expect(screen.getByRole("navigation", { name: "Apps (collapsed)" })).toBeInTheDocument();
    expect(screen.queryByText("pdfer")).toBeNull(); // names are hidden
    expect(screen.getByRole("button", { name: "Open Qonsol" })).toHaveTextContent("Q");
    expect(screen.getByRole("img", { name: "App status: green" })).toBeInTheDocument(); // Qonsol is running
    await userEvent.click(screen.getByRole("button", { name: "Open pdfer" }));
    expect(h.onSelectApp).toHaveBeenCalledWith("a2");
    await userEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(h.onHome).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(h.onTogglePane).toHaveBeenCalled();
  });

  it("USR-004: a folded app stays folded after the pane collapses and expands again", async () => {
    function Harness() {
      const [collapsed, setCollapsed] = useState(false);
      return (
        <Sidebar
          apps={apps}
          selectedAppId="a1"
          selectedTerminalId="t1"
          stateOf={stateOf}
          homeActive={false}
          onSelectApp={vi.fn()}
          onSelectTerminal={vi.fn()}
          onHome={vi.fn()}
          paneCollapsed={collapsed}
          onTogglePane={() => setCollapsed((c) => !c)}
        />
      );
    }
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Collapse Qonsol" }));
    expect(screen.queryByText("api")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    await userEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));

    expect(screen.getByText("Qonsol")).toBeInTheDocument();
    expect(screen.queryByText("api")).toBeNull(); // still folded, not re-expanded
    expect(screen.getByRole("button", { name: "Expand Qonsol" })).toBeInTheDocument();
  });
});
