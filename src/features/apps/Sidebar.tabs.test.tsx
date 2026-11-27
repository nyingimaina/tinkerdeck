// Vitest runs these files in Node, but the app's browser build has no Node types.
// @ts-expect-error node:fs is available test-time only
import { readFileSync } from "node:fs";
// @ts-expect-error node:path is available test-time only
import { join } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import type { AppDef, TermState } from "../../state/model";

declare const process: { cwd(): string };

const apps: AppDef[] = [
  { id: "a1", name: "Qonsol", root: "E:\\q", terminals: [{ id: "t1", name: "api", cwd: ".", command: "", env: {} }] },
  { id: "a2", name: "pdfer", root: "E:\\p", terminals: [{ id: "t2", name: "web", cwd: ".", command: "", env: {} }] },
];
const stateOf = (_id: string): TermState => ({ kind: "stopped" });

const manyApps = (count: number, terminals: number): AppDef[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `a${i}`,
    name: `App ${i}`,
    root: `E:\\project-${i}`,
    terminals: Array.from({ length: terminals }, (_, j) => ({
      id: `t${i}-${j}`,
      name: `terminal ${i}.${j}`,
      cwd: ".",
      command: "",
      env: {},
    })),
  }));

interface Handlers {
  onSelectApp: ReturnType<typeof vi.fn>;
  onSelectTerminal: ReturnType<typeof vi.fn>;
  onHome: ReturnType<typeof vi.fn>;
}

const renderSidebar = (explorer: ReactNode = <section aria-label="Files">explorer tree</section>, list = apps) => {
  const h: Handlers = { onSelectApp: vi.fn(), onSelectTerminal: vi.fn(), onHome: vi.fn() };
  const view = render(
    <Sidebar
      apps={list}
      selectedAppId="a1"
      selectedTerminalId="t1"
      stateOf={stateOf}
      homeActive={false}
      {...h}
      explorer={explorer}
    />,
  );
  return { ...h, unmount: view.unmount };
};

/** A sidebar whose parent really expands and collapses it, as the app shell does. */
function Pane({ startCollapsed = false }: { startCollapsed?: boolean }) {
  const [collapsed, setCollapsed] = useState(startCollapsed);
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
      explorer={<section aria-label="Files">explorer tree</section>}
    />
  );
}

const tab = (name: string) => screen.getByRole("tab", { name });
const filesRegion = () => screen.queryByRole("region", { name: "Files" });

const cssModule = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const sidebarCss = cssModule("src/features/apps/Sidebar.module.css");
const tabsCss = cssModule("src/features/apps/SidebarTabs.module.css");

const block = (css: string, selector: string): string =>
  new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
const declaration = (source: string, property: string): string =>
  new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*([^;]+);`).exec(source)?.[1]?.trim() ?? "";

describe("the Projects | Files tabs (R1)", () => {
  it("R1: the expanded sidebar opens on Projects, showing the Home row and apps but not the explorer", () => {
    renderSidebar();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tab("Projects")).toHaveAttribute("aria-selected", "true");
    expect(tab("Files")).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("button", { name: /Home/ })).toBeInTheDocument();
    expect(screen.getByText("Qonsol")).toBeInTheDocument();
    expect(screen.getByText("api")).toBeInTheDocument();
    expect(filesRegion()).toBeNull();
    expect(screen.queryByRole("tabpanel", { name: "Files" })).toBeNull();
  });

  it("R1: choosing Files shows only the explorer, filling the sidebar, and hides the Projects content", async () => {
    renderSidebar();
    const projects = screen.getByRole("tabpanel", { name: "Projects" });
    await userEvent.click(tab("Files"));
    expect(tab("Files")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Files" })).toContainElement(filesRegion());
    expect(screen.queryByRole("button", { name: /Home/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Qonsol/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /api/ })).toBeNull();
    // The explorer is its own tab, not a block below the last terminal.
    expect(projects).not.toContainElement(filesRegion());
  });

  it("R1: clicking a tab never selects an app, a terminal or Home", async () => {
    const h = renderSidebar();
    await userEvent.click(tab("Files"));
    await userEvent.click(tab("Projects"));
    expect(h.onSelectApp).not.toHaveBeenCalled();
    expect(h.onSelectTerminal).not.toHaveBeenCalled();
    expect(h.onHome).not.toHaveBeenCalled();
  });

  it("R4: selecting an app or a terminal in Projects leaves the tab alone", async () => {
    renderSidebar();
    await userEvent.click(screen.getByText("Qonsol"));
    await userEvent.click(screen.getByText("api"));
    expect(tab("Projects")).toHaveAttribute("aria-selected", "true");
  });

  it("R4: choosing Home from the sidebar does not switch the tab", async () => {
    renderSidebar();
    await userEvent.click(screen.getByRole("button", { name: /Home/ }));
    expect(tab("Projects")).toHaveAttribute("aria-selected", "true");
  });

  it("R4: opening a file from the Files tab leaves the sidebar on Files", async () => {
    renderSidebar(
      <section aria-label="Files">
        <button>open README.md</button>
      </section>,
    );
    await userEvent.click(tab("Files"));
    await userEvent.click(screen.getByRole("button", { name: "open README.md" }));
    expect(tab("Files")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Files" })).toBeInTheDocument();
  });

  it("R1: the chosen tab is not remembered, so reopening starts on Projects again", async () => {
    const first = renderSidebar();
    await userEvent.click(tab("Files"));
    expect(tab("Files")).toHaveAttribute("aria-selected", "true");
    first.unmount();

    renderSidebar();
    expect(tab("Projects")).toHaveAttribute("aria-selected", "true");
    expect(filesRegion()).toBeNull();
  });
});

describe("the fixed tab strip (R2)", () => {
  it("R2: the strip sits outside the scrolling Projects panel, so it cannot scroll away", async () => {
    renderSidebar(undefined, manyApps(50, 10));
    const list = screen.getByRole("tablist");
    const projects = screen.getByRole("tabpanel", { name: "Projects" });
    expect(projects.contains(list)).toBe(false);
    expect(list.closest('[role="tabpanel"]')).toBeNull();
    // 500 terminals below do not push Files out of reach: it is still there and selectable.
    expect(tab("Files")).toBeInTheDocument();
    await userEvent.click(tab("Files"));
    expect(tab("Files")).toHaveAttribute("aria-selected", "true");
    expect(filesRegion()).toBeInTheDocument();
  });

  it("R2: the strip sits above the Projects list, at the same place however long that list is", () => {
    const placeOf = (list: AppDef[]) => {
      const view = render(
        <Sidebar
          apps={list}
          selectedAppId="a1"
          selectedTerminalId="t1"
          stateOf={stateOf}
          homeActive={false}
          onSelectApp={vi.fn()}
          onSelectTerminal={vi.fn()}
          onHome={vi.fn()}
          explorer={<section aria-label="Files">explorer tree</section>}
        />,
      );
      const tabsList = screen.getByRole("tablist");
      const projects = screen.getByRole("tabpanel", { name: "Projects" });
      const nav = tabsList.closest("nav");
      expect(nav).not.toBeNull();
      const stripRow = nav!.children[0] as HTMLElement;
      // The strip's own row is the nav's first child; the scrolling Projects panel sits after it.
      expect(stripRow).toContainElement(tabsList);
      expect(nav!.children[1]).toBe(projects);
      // Moving the strip below the list would make the Projects panel precede it instead.
      expect(tabsList.compareDocumentPosition(projects) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(4);
      const place = Array.from(nav!.children).indexOf(stripRow);
      view.unmount();
      return place;
    };

    const one = placeOf(apps);
    const many = placeOf(manyApps(50, 10));
    expect(one).toBe(0);
    expect(many).toBe(one);
  });

  it("R2: switching tabs does not reconcile the 500-row Projects list", async () => {
    let reads = 0;
    const countingStateOf = (_id: string): TermState => {
      reads += 1;
      return { kind: "stopped" };
    };
    const list = manyApps(50, 10);
    render(
      <Sidebar
        apps={list}
        selectedAppId="a0"
        selectedTerminalId="t0-0"
        stateOf={countingStateOf}
        onSelectApp={vi.fn()}
        onSelectTerminal={vi.fn()}
        explorer={<section aria-label="Files">explorer tree</section>}
      />,
    );
    const before = reads;
    expect(before).toBeGreaterThanOrEqual(500);

    await userEvent.click(tab("Files"));
    await userEvent.click(tab("Projects"));
    expect(tab("Projects")).toHaveAttribute("aria-selected", "true");
    // A tab switch flips two hidden flags and the pill; the memoised list is not re-rendered.
    expect(reads).toBe(before);
  });

  it("R2: CSS keeps the strip in a fixed row and lets only the panels scroll", () => {
    const sidebar = block(sidebarCss, ".sidebar");
    const topRow = block(sidebarCss, ".topRow");
    const panel = block(sidebarCss, ".panel");
    expect(sidebar).toContain("display: flex");
    expect(sidebar).toContain("flex-direction: column");
    expect(sidebar).not.toContain("overflow-y: auto");
    expect(declaration(topRow, "flex")).toBe("none");
    expect(declaration(panel, "overflow-y")).toBe("auto");
    expect(declaration(panel, "min-height")).toBe("0");
    expect(block(sidebarCss, ".panel[hidden]")).toContain("display: none");
    expect(declaration(block(sidebarCss, ".filesPanel"), "min-height")).toBe("0");
  });

  it("R2: the two tabs stay inside the narrow sidebar without widening it", () => {
    const list = block(tabsCss, ".list");
    const active = block(tabsCss, ".tab");
    expect(active).toContain("flex: 1 1 0");
    expect(declaration(active, "min-width")).toBe("0");
    expect(declaration(active, "text-overflow")).toBe("ellipsis");
    expect(declaration(active, "white-space")).toBe("nowrap");
    expect(declaration(list, "overflow-x")).toBe("auto");
    expect(declaration(block(sidebarCss, ".sidebar"), "width")).toBe("240px");
  });
});

describe("the tab switch at the performance budget (R10)", () => {
  it("R10: with 300 apps and 3,000 terminals, switching Projects -> Files -> Projects updates the panel in under 100 ms without remounting the loaded explorer", () => {
    const list = manyApps(300, 10);
    const listings = { count: 0 };
    // Stands in for the mounted explorer: a listing happens on mount, so any remount would count.
    function CountingExplorer() {
      useEffect(() => {
        listings.count += 1;
      }, []);
      return <section aria-label="Files">explorer tree</section>;
    }

    render(
      <Sidebar
        apps={list}
        selectedAppId="a0"
        selectedTerminalId="t0-0"
        stateOf={stateOf}
        onSelectApp={vi.fn()}
        onSelectTerminal={vi.fn()}
        onHome={vi.fn()}
        explorer={<CountingExplorer />}
      />,
    );

    // Open Files once so the measurement covers an already mounted, already loaded explorer.
    fireEvent.click(tab("Files"));
    fireEvent.click(tab("Projects"));
    const listingsBefore = listings.count;
    expect(listingsBefore).toBe(1);

    // Resolve the tab elements up front so the timer measures the switch, not the DOM queries.
    const filesTab = tab("Files");
    const projectsTab = tab("Projects");
    const started = performance.now();
    fireEvent.click(filesTab);
    fireEvent.click(projectsTab);
    const elapsed = performance.now() - started;

    expect(tab("Projects")).toHaveAttribute("aria-selected", "true");
    expect(filesRegion()).toBeNull();
    expect(elapsed).toBeLessThan(100);
    // The mounted explorer keeps its loaded levels: coming back lists nothing again.
    expect(listings.count).toBe(listingsBefore);
  });
});

describe("the tab strip for keyboard and screen readers (R5)", () => {
  it("R5: it exposes a named tab list with two labelled tabs, a tab panel and the selected tab", () => {
    renderSidebar();
    const list = screen.getByRole("tablist", { name: "Sidebar sections" });
    expect(within(list).getAllByRole("tab")).toHaveLength(2);
    expect(tab("Projects")).toHaveTextContent("Projects");
    expect(tab("Files")).toHaveTextContent("Files");
    expect(tab("Projects")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Projects" })).toBeInTheDocument();
  });

  it("R5: Left and Right arrow keys move the selection between the tabs", async () => {
    renderSidebar();
    tab("Projects").focus();
    expect(tab("Projects")).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    expect(tab("Files")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Files" })).toBeInTheDocument();
    await userEvent.keyboard("{ArrowLeft}");
    expect(tab("Projects")).toHaveAttribute("aria-selected", "true");
  });

  it("R5: Enter and Space select the focused tab", async () => {
    renderSidebar();
    tab("Files").focus();
    await userEvent.keyboard("{Enter}");
    expect(tab("Files")).toHaveAttribute("aria-selected", "true");

    tab("Projects").focus();
    await userEvent.keyboard(" ");
    expect(tab("Projects")).toHaveAttribute("aria-selected", "true");
  });

  it("R5: each tab is programmatically linked to the panel it controls", async () => {
    renderSidebar();
    const projectsTab = tab("Projects");
    const projectsPanel = screen.getByRole("tabpanel", { name: "Projects" });
    expect(projectsTab.id).not.toBe("");
    expect(projectsTab).toHaveAttribute("aria-controls", projectsPanel.id);
    expect(projectsPanel).toHaveAttribute("aria-labelledby", projectsTab.id);

    await userEvent.click(tab("Files"));
    const filesTab = tab("Files");
    const filesPanel = screen.getByRole("tabpanel", { name: "Files" });
    expect(filesTab.id).not.toBe("");
    expect(filesTab.id).not.toBe(projectsTab.id);
    expect(filesTab).toHaveAttribute("aria-controls", filesPanel.id);
    expect(filesPanel).toHaveAttribute("aria-labelledby", filesTab.id);
  });

  it("R5: the selected tab is announced and also visually distinct, not shown by colour alone", () => {
    renderSidebar();
    expect(tab("Projects")).toHaveAttribute("aria-selected", "true");
    expect(tab("Projects").className).not.toBe(tab("Files").className);
    expect(tab("Projects").className).toContain("activeTab");
    expect(declaration(block(tabsCss, ".activeTab"), "font-weight")).toBe("700");
    expect(block(tabsCss, ".activeTab::after")).not.toBe("");
  });

  it("R5: the focused tab is reachable and shows a visible focus ring", () => {
    renderSidebar();
    expect(tab("Projects")).toHaveAttribute("tabindex", "0");
    expect(tab("Files")).toHaveAttribute("tabindex", "-1");
    tab("Files").focus();
    expect(tab("Files")).toHaveFocus();
    expect(block(tabsCss, ".tab:focus-visible")).toContain("outline");
  });
});

describe("the rail tab icons (R3)", () => {
  it("R3: the rail keeps Expand, Home and the app initials and adds the Projects and Files icons", () => {
    render(
      <Sidebar apps={apps} selectedAppId="a1" selectedTerminalId="t1" stateOf={stateOf} homeActive={false} onHome={vi.fn()} onSelectApp={vi.fn()} onSelectTerminal={vi.fn()} paneCollapsed onTogglePane={vi.fn()} />,
    );
    expect(screen.getByRole("navigation", { name: "Apps (collapsed)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Qonsol" })).toHaveTextContent("Q");
    expect(screen.getByRole("button", { name: "Open pdfer" })).toHaveTextContent("P");
    expect(screen.getAllByRole("img", { name: "App status: grey" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Files" })).toBeInTheDocument();
  });

  it("R3: the rail shows both tab icons even with no apps", () => {
    render(
      <Sidebar apps={[]} selectedAppId={null} selectedTerminalId={null} stateOf={stateOf} onSelectApp={vi.fn()} onSelectTerminal={vi.fn()} paneCollapsed onTogglePane={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Files" })).toBeInTheDocument();
  });

  it("R3: both rail icons carry an accessible name and a title", () => {
    render(
      <Sidebar apps={apps} selectedAppId="a1" selectedTerminalId="t1" stateOf={stateOf} homeActive={false} onHome={vi.fn()} onSelectApp={vi.fn()} onSelectTerminal={vi.fn()} paneCollapsed onTogglePane={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Projects" })).toHaveAttribute("title", "Projects");
    expect(screen.getByRole("button", { name: "Files" })).toHaveAttribute("title", "Files");
  });

  it("R3: clicking the Projects rail icon expands the pane onto Projects in one action", async () => {
    render(<Pane startCollapsed />);
    // First put the pane on Files, then collapse it, so Projects is a real change of tab.
    await userEvent.click(screen.getByRole("button", { name: "Files" }));
    expect(tab("Files")).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    await userEvent.click(screen.getByRole("button", { name: "Projects" }));
    expect(tab("Projects")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Projects" })).toBeInTheDocument();
    expect(filesRegion()).toBeNull();
  });

  it("R3: clicking the Files rail icon expands the pane onto Files in one action", async () => {
    render(<Pane startCollapsed />);
    await userEvent.click(screen.getByRole("button", { name: "Files" }));
    expect(screen.getByRole("navigation", { name: "Apps" })).toBeInTheDocument();
    expect(tab("Files")).toHaveAttribute("aria-selected", "true");
    expect(filesRegion()).toHaveTextContent("explorer tree");
  });

  it("R3: the rail visibly marks the active tab", async () => {
    render(<Pane startCollapsed />);
    expect(screen.getByRole("button", { name: "Projects" }).className).toContain("railOn");
    expect(screen.getByRole("button", { name: "Files" }).className).not.toContain("railOn");

    await userEvent.click(screen.getByRole("button", { name: "Files" }));
    await userEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.getByRole("button", { name: "Files" }).className).toContain("railOn");
    expect(screen.getByRole("button", { name: "Projects" }).className).not.toContain("railOn");
  });

  it("R3: clicking Home or an app initial in the rail does not change the active tab", async () => {
    render(<Pane startCollapsed />);
    await userEvent.click(screen.getByRole("button", { name: "Files" }));
    await userEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    await userEvent.click(screen.getByRole("button", { name: "Home" }));
    await userEvent.click(screen.getByRole("button", { name: "Open Qonsol" }));
    expect(screen.getByRole("navigation", { name: "Apps (collapsed)" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(tab("Files")).toHaveAttribute("aria-selected", "true");
  });
});

describe("the Projects roll-up dot (R7)", () => {
  const states = (map: Record<string, TermState>) => (id: string): TermState => map[id] ?? { kind: "stopped" };
  const mount = (stateOf: (id: string) => TermState, list = apps) =>
    render(
      <Sidebar
        apps={list}
        selectedAppId="a1"
        selectedTerminalId="t1"
        stateOf={stateOf}
        homeActive={false}
        onSelectApp={vi.fn()}
        onSelectTerminal={vi.fn()}
        onHome={vi.fn()}
        explorer={<section aria-label="Files">explorer tree</section>}
      />,
    );
  const tabDot = () => tab("Projects").querySelector("[data-kind]");

  it("R7: the Projects label carries exactly one roll-up dot, coloured by the existing rules", () => {
    let view = mount(states({ t1: { kind: "failedToStart", reason: "boom" }, t2: { kind: "running" } }));
    expect(tab("Projects").querySelectorAll("[data-kind]")).toHaveLength(1);
    expect(tabDot()).toHaveAttribute("data-kind", "red");
    view.unmount();

    view = mount(states({ t1: { kind: "running" }, t2: { kind: "running" } }));
    expect(tabDot()).toHaveAttribute("data-kind", "green");
    view.unmount();

    view = mount(states({ t1: { kind: "running" }, t2: { kind: "stopping" } }));
    expect(tabDot()).toHaveAttribute("data-kind", "amber");
    view.unmount();

    view = mount(states({}));
    expect(tabDot()).toHaveAttribute("data-kind", "grey");
    view.unmount();
  });

  it("R7: non-executable terminals are excluded and no executable terminals shows grey", () => {
    const mixed: AppDef[] = [
      { id: "a1", name: "Qonsol", root: "E:\\q", terminals: [{ id: "t1", name: "api", cwd: ".", command: "", env: {} }] },
      {
        id: "a2",
        name: "pdfer",
        root: "E:\\p",
        terminals: [{ id: "t2", name: "web", cwd: ".", command: "", env: {}, executable: false }],
      },
    ];
    let view = mount(states({ t1: { kind: "running" }, t2: { kind: "failedToStart", reason: "boom" } }), mixed);
    expect(tabDot()).toHaveAttribute("data-kind", "green");
    view.unmount();

    view = mount(states({}), [{ id: "a1", name: "Qonsol", root: "E:\\q", terminals: [] }]);
    expect(tabDot()).toHaveAttribute("data-kind", "grey");
    view.unmount();

    view = mount(states({}), []);
    expect(tabDot()).toHaveAttribute("data-kind", "grey");
  });

  it("R7: the dot is also on the rail Projects icon and keeps the button names intact", () => {
    render(
      <Sidebar
        apps={apps}
        selectedAppId="a1"
        selectedTerminalId="t1"
        stateOf={states({ t1: { kind: "running" }, t2: { kind: "running" } })}
        homeActive={false}
        onSelectApp={vi.fn()}
        onSelectTerminal={vi.fn()}
        onHome={vi.fn()}
        paneCollapsed
        onTogglePane={vi.fn()}
      />,
    );
    const railProjects = screen.getByRole("button", { name: "Projects" });
    const dots = railProjects.querySelectorAll("[data-kind]");
    expect(dots).toHaveLength(1);
    expect(dots[0]).toHaveAttribute("data-kind", "green");
    expect(railProjects).toHaveAccessibleName("Projects");
    expect(screen.getByRole("button", { name: "Files" }).querySelector("[data-kind]")).toBeNull();
  });

  it("R7: the label dot is there when Files is selected and the tab is still named Projects", async () => {
    mount(states({ t1: { kind: "running" }, t2: { kind: "running" } }));
    await userEvent.click(tab("Files"));
    expect(tab("Files")).toHaveAttribute("aria-selected", "true");
    expect(tabDot()).toHaveAttribute("data-kind", "green");
    expect(tab("Projects")).toHaveAccessibleName("Projects");
  });

  it("REV-1 R7: assistive technology gets the roll-up from the Projects tab's description, keeping its name and the img count", () => {
    let view = mount(states({ t1: { kind: "failedToStart", reason: "boom" }, t2: { kind: "running" } }));
    expect(tab("Projects")).toHaveAccessibleName("Projects");
    // The same label the dot carries is now announced even though the dot stays decorative.
    expect(tab("Projects")).toHaveAccessibleDescription("App status: red");
    view.unmount();

    view = mount(states({}));
    expect(tab("Projects")).toHaveAccessibleDescription("App status: grey");
    // Only the two per-app dots are role=img; the tab's own dot adds no duplicate status image.
    expect(screen.getAllByRole("img", { name: "App status: grey" })).toHaveLength(2);
    view.unmount();
  });

  it("REV-1 R7: the rail Projects button describes the same roll-up without changing its name or dot count", () => {
    render(
      <Sidebar
        apps={apps}
        selectedAppId="a1"
        selectedTerminalId="t1"
        stateOf={states({ t1: { kind: "failedToStart", reason: "boom" }, t2: { kind: "running" } })}
        homeActive={false}
        onSelectApp={vi.fn()}
        onSelectTerminal={vi.fn()}
        onHome={vi.fn()}
        paneCollapsed
        onTogglePane={vi.fn()}
      />,
    );
    const railProjects = screen.getByRole("button", { name: "Projects" });
    expect(railProjects).toHaveAccessibleDescription("App status: red");
    expect(railProjects.querySelectorAll("[data-kind]")).toHaveLength(1);
    // The per-app dots only: the roll-up is text, not a second status image.
    expect(screen.getAllByRole("img", { name: /^App status: / })).toHaveLength(2);
  });
});

describe("the Files panel mounts on first use (A1)", () => {
  it("A1: it is not mounted while Projects is shown, and stays mounted once opened", async () => {
    const mounts = { count: 0 };
    function Probe() {
      useEffect(() => {
        mounts.count += 1;
      }, []);
      return <section aria-label="Files">explorer tree</section>;
    }

    renderSidebar(<Probe />);
    expect(mounts.count).toBe(0);
    expect(filesRegion()).toBeNull();

    await userEvent.click(tab("Files"));
    expect(mounts.count).toBe(1);
    expect(filesRegion()).toBeInTheDocument();

    await userEvent.click(tab("Projects"));
    expect(filesRegion()).toBeNull();
    expect(mounts.count).toBe(1);

    await userEvent.click(tab("Files"));
    expect(mounts.count).toBe(1);
    expect(filesRegion()).toBeInTheDocument();
  });
});



