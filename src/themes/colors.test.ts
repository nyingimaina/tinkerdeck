import { describe, expect, it } from "vitest";
import { contrast, luminance, mix, parseColor, readableOn, solid, toHex } from "./colors";

describe("colour helpers", () => {
  it("parses hex in all its lengths and rgb()", () => {
    expect(parseColor("#fa0")).toEqual({ r: 255, g: 170, b: 0, a: 1 });
    expect(parseColor("#ffaa00")).toEqual({ r: 255, g: 170, b: 0, a: 1 });
    expect(parseColor("#FFAA00")).toEqual({ r: 255, g: 170, b: 0, a: 1 });
    expect(parseColor("#11223380")?.a).toBeCloseTo(0.502, 2);
    expect(parseColor("#1238")?.a).toBeCloseTo(0.533, 2);
    expect(parseColor("rgb(1, 2, 3)")).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(parseColor("rgba(1,2,3,0.5)")).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
  });

  it("rejects anything else", () => {
    for (const bad of ["", "nope", "#12", "#12345", "#gg0000", "transparent", "rgb(1,2)"]) expect(parseColor(bad), bad).toBeNull();
  });

  it("writes hex without alpha", () => {
    expect(toHex({ r: 255, g: 170, b: 0, a: 1 })).toBe("#ffaa00");
    expect(toHex({ r: 0, g: 0, b: 0, a: 0.2 })).toBe("#000000");
  });

  it("flattens a translucent colour over its background", () => {
    expect(solid("#ffffff80", "#000000")).toBe("#808080");
    expect(solid("#ff0000", "#00ff00")).toBe("#ff0000");
    expect(solid("not a colour", "#123456")).toBe("#123456");
  });

  it("mixes two colours", () => {
    expect(mix("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mix("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("measures contrast and picks readable text", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrast("#777777", "#777777")).toBeCloseTo(1, 5);
    expect(luminance("#ffffff")).toBeCloseTo(1, 5);
    expect(readableOn("#facc15")).toBe("#14110a");
    expect(readableOn("#101216")).toBe("#ffffff");
  });
});
