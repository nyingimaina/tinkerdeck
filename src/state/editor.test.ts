import { describe, expect, it } from "vitest";
import { binDaysLeft, encodingLabel, eolLabel, BIN_DAYS, IDLE_DAYS } from "./editor";

const DAY = 86400;

describe("editor helpers", () => {
  it("counts the days left in the bin and never goes negative", () => {
    expect(binDaysLeft(1000, 1000)).toBe(BIN_DAYS);
    expect(binDaysLeft(1000, 1000 + 3 * DAY + 5)).toBe(BIN_DAYS - 3);
    expect(binDaysLeft(1000, 1000 + 99 * DAY)).toBe(0);
    expect(binDaysLeft(null, 5)).toBe(BIN_DAYS);
  });

  it("uses the rules the user asked for: 7 idle days, 30 days in the bin", () => {
    expect(IDLE_DAYS).toBe(7);
    expect(BIN_DAYS).toBe(30);
  });

  it("names line endings and encodings in plain words", () => {
    expect(eolLabel("crlf")).toBe("Windows (CRLF)");
    expect(eolLabel("lf")).toBe("Unix (LF)");
    expect(encodingLabel("utf-8")).toBe("UTF-8");
    expect(encodingLabel("utf-8-bom")).toBe("UTF-8 with BOM");
    expect(encodingLabel("utf-16le")).toBe("UTF-16 LE");
    expect(encodingLabel("latin1")).toBe("Latin-1");
    expect(encodingLabel("weird")).toBe("weird");
  });
});
