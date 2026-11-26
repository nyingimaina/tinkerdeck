import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import type { AppDef, TermState } from "../../state/model";

const apps: AppDef[] = [
  { id: "a1", name: "Qonsol", root: "E:\\q", terminals: [{ id: "t1", name: "api", cwd: ".", command: "", env: {} }] },
  { id: "a2", name: "pdfer", root: "E:\\p", terminals: [{ id: "t2", name: "web", cwd: ".", command: "", env: {} }] },
];
const stateOf = (_id: string): TermState => ({ kind: "stopped" });

const renderSidebar = (explorer?: ReactNode) =>
  render(
    <Sidebar
      apps={apps}
      selectedAppId="a1"
      selectedTerminalId="t1"
      stateOf={stateOf}
      homeActive={false}
      onSelectApp={vi.fn()}
      onSelectTerminal={vi.fn()}
      onHome={vi.fn()}
      explorer={explorer}
    />,
  );

describe("the Files section in the sidebar", () => {
  it("R2: it sits beside the apps list in the expanded pane", () => {
    renderSidebar(<section aria-label="Files">explorer tree</section>);
    expect(screen.getByText("Qonsol")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Home/ })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Files" })).toHaveTextContent("explorer tree");
  });

  it("A3: with no explorer prop the app rows and Home row are exactly as before", () => {
    renderSidebar();
    expect(screen.getByText("Qonsol")).toBeInTheDocument();
    expect(screen.getByText("pdfer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Home/ })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Files" })).toBeNull();
  });

  it("A3: the collapsed rail never shows the Files section", () => {
    render(
      <Sidebar
        apps={apps}
        selectedAppId="a1"
        selectedTerminalId="t1"
        stateOf={stateOf}
        homeActive={false}
        paneCollapsed
        onTogglePane={vi.fn()}
        onSelectApp={vi.fn()}
        onSelectTerminal={vi.fn()}
        onHome={vi.fn()}
        explorer={<section aria-label="Files">explorer tree</section>}
      />,
    );
    expect(screen.getByRole("navigation", { name: "Apps (collapsed)" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Files" })).toBeNull();
    expect(screen.queryByText("explorer tree")).toBeNull();
  });

  it("A4: with no apps saved the sidebar still shows the Files section", () => {
    render(
      <Sidebar
        apps={[]}
        selectedAppId={null}
        selectedTerminalId={null}
        stateOf={stateOf}
        onSelectApp={vi.fn()}
        onSelectTerminal={vi.fn()}
        explorer={<section aria-label="Files">loose file folder</section>}
      />,
    );
    expect(screen.getByRole("navigation", { name: "Apps" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Files" })).toHaveTextContent("loose file folder");
  });
});
