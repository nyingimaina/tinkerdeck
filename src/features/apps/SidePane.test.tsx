// @ts-expect-error -- Node's fs is available to the test runner; the window build ships no Node types.
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SidePane } from "./SidePane";

const pane = () => document.querySelector('[class*="ZestResponsiveLayout-module_sidePane"]');

const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
const readJson = (path: string) => JSON.parse(readFileSync(`${cwd}/${path}`, "utf8"));

describe("SidePane", () => {
  it("A2: package.json and package-lock.json record the approved 2.8.0 responsive-layout package", () => {
    const pkg = readJson("package.json") as { dependencies?: Record<string, string> };
    expect(pkg.dependencies?.["jattac.libs.web.zest-responsive-layout"]).toBe("^2.8.0");

    const lock = readJson("package-lock.json") as {
      packages?: Record<string, { version?: string }>;
    };
    const entry = lock.packages?.["node_modules/jattac.libs.web.zest-responsive-layout"];
    expect(entry?.version).toBe("2.8.0");
  });

  it("R8/A2: renders its content inside the approved package's side pane with its own stylesheet", () => {
    render(
      <SidePane title="Find themes">
        <p>Body</p>
      </SidePane>,
    );
    expect(screen.getByText("Body")).toBeInTheDocument();
    expect(pane()).not.toBeNull();
    const css = [...document.head.querySelectorAll("style")]
      .map((s) => s.textContent ?? "")
      .join("\n");
    expect(css).toContain("ZestResponsiveLayout-module_sidePane");
  });

  it("A3: the close control has an accessible name and runs the close action", async () => {
    const onClose = vi.fn();
    render(
      <SidePane onClose={onClose} closeLabel="Close Find themes">
        <p>Body</p>
      </SidePane>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Close Find themes" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("A3: Escape dismisses a pane that has a close action", async () => {
    const onClose = vi.fn();
    render(
      <SidePane onClose={onClose}>
        <p>Body</p>
      </SidePane>,
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("A3: a pane with no close action has no close control and Escape does nothing", async () => {
    render(
      <SidePane>
        <p>Body</p>
      </SidePane>,
    );
    expect(screen.queryByRole("button")).toBeNull();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByText("Body")).toBeInTheDocument();
  });

  it("R8: the pane takes the app theme's panel and text colours so dialogs stay readable in the dark theme", () => {
    render(
      <SidePane onClose={vi.fn()}>
        <p>Body</p>
      </SidePane>,
    );
    const element = pane() as HTMLElement;
    const style = element.getAttribute("style") ?? "";
    expect(style).toContain("background: var(--panel)");
    expect(style).toContain("color: var(--text)");
    expect(style).toContain("--zest-pane-bg: var(--panel)");
    expect(style).toContain("--zest-pane-divider: var(--border)");
  });

  it("R8: at a 360px-wide window the package uses its full-width mobile pane", () => {
    const width = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 360 });
    try {
      render(
        <SidePane onClose={vi.fn()}>
          <p>Body</p>
        </SidePane>,
      );
      expect(pane()?.className).toContain("mobileOverlay");
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    }
  });
});
