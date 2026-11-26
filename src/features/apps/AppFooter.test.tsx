import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppFooter } from "./AppFooter";

describe("AppFooter", () => {
  it("R2: keeps a persistent status footer that shows the app version", () => {
    render(<AppFooter version="2.0.0" />);
    const footer = screen.getByRole("contentinfo", { name: "Status" });
    expect(footer).toHaveTextContent("Tinkerdeck");
    expect(footer).toHaveTextContent("v2.0.0");
  });

  it("R2: adds no control that duplicates a primary action", () => {
    render(<AppFooter version="2.0.0" />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("R2: says so plainly when the version is not available", () => {
    render(<AppFooter version="" />);
    expect(screen.getByRole("contentinfo", { name: "Status" })).toHaveTextContent("version unknown");
  });

  it("R6: keeps one sidebar toggle that reads and reports the shared sidebar state", async () => {
    const onToggle = vi.fn();
    render(<AppFooter version="2.0.0" sidebarCollapsed={false} onToggleSidebar={onToggle} />);
    const toggle = screen.getByRole("button", { name: "Toggle sidebar" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.getAllByRole("button")).toHaveLength(1);
    await userEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("R6: shows the footer toggle in its collapsed state when the sidebar is collapsed", () => {
    render(<AppFooter version="2.0.0" sidebarCollapsed onToggleSidebar={() => {}} />);
    expect(screen.getByRole("button", { name: "Toggle sidebar" })).toHaveAttribute("aria-pressed", "true");
  });

  it("R6: the footer stays above optional parts: the toggle is rendered beside the version, never instead of it", () => {
    render(<AppFooter version="2.0.0" sidebarCollapsed={false} onToggleSidebar={() => {}} />);
    const footer = screen.getByRole("contentinfo", { name: "Status" });
    expect(footer).toHaveTextContent("Tinkerdeck");
    expect(footer).toHaveTextContent("v2.0.0");
    expect(footer).toContainElement(screen.getByRole("button", { name: "Toggle sidebar" }));
  });
});
