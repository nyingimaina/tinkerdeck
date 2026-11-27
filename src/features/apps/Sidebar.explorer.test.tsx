import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

const showFiles = async () => {
  await userEvent.click(screen.getByRole("tab", { name: "Files" }));
  return await screen.findByRole("region", { name: "Files" });
};

describe("the Files tab in the sidebar", () => {
  it("A2: Projects still lists the Home row, every app and every terminal with a roll-up dot", () => {
    renderSidebar(<section aria-label="Files">explorer tree</section>);
    expect(screen.getByRole("button", { name: /Home/ })).toBeInTheDocument();
    expect(screen.getByText("Qonsol")).toBeInTheDocument();
    expect(screen.getByText("pdfer")).toBeInTheDocument();
    expect(screen.getByText("api")).toBeInTheDocument();
    expect(screen.getByText("web")).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: "App status: grey" })).toHaveLength(2);
  });

  it("R1: the explorer sits in the Files tab, not below the last app in Projects", async () => {
    renderSidebar(<section aria-label="Files">explorer tree</section>);
    const projects = screen.getByRole("tabpanel", { name: "Projects" });
    expect(screen.queryByRole("region", { name: "Files" })).toBeNull();

    const files = await showFiles();
    expect(files).toHaveTextContent("explorer tree");
    expect(screen.getByRole("tabpanel", { name: "Files" })).toContainElement(files);
    expect(projects).not.toContainElement(files);
  });

  it("A2: with no explorer prop the Projects content is exactly as before", () => {
    renderSidebar();
    expect(screen.getByText("Qonsol")).toBeInTheDocument();
    expect(screen.getByText("pdfer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Home/ })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Files" })).toBeNull();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("A2: the collapsed rail keeps Expand, Home and every app initial and now adds the two tab icons", () => {
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
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Qonsol" })).toHaveTextContent("Q");
    expect(screen.getByRole("button", { name: "Open pdfer" })).toHaveTextContent("P");
    expect(screen.getAllByRole("img", { name: "App status: grey" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Files" })).toBeInTheDocument();
    // The rail still never shows the Files region itself; the pane expands to it instead.
    expect(screen.queryByRole("region", { name: "Files" })).toBeNull();
    expect(screen.queryByText("explorer tree")).toBeNull();
  });

  it("R1: with no apps saved the sidebar still shows both tabs when the explorer has a folder", async () => {
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
    expect(screen.getByRole("tab", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Files" })).toBeInTheDocument();

    const files = await showFiles();
    expect(files).toHaveTextContent("loose file folder");
    expect(screen.queryByRole("button", { name: /Home/ })).toBeNull();
    expect(within(files).getByText("loose file folder")).toBeInTheDocument();
  });
});
