import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
});
