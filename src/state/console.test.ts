import { describe, expect, it } from "vitest";
import {
  consoleExitAction,
  consoleId,
  consoleInstanceId,
  consoleTitle,
  isConsoleId,
  nextConsoleNumber,
  parseConsoleId,
  RESTART_GUARD_MS,
} from "./console";

describe("console ids", () => {
  it("build and parse instance ids with and without a shell", () => {
    expect(consoleInstanceId("a1", 2)).toBe("console-a1:2");
    expect(consoleInstanceId("a1", 3, "gitbash")).toBe("console-a1:3:gitbash");
    expect(parseConsoleId("console-a1:3:gitbash")).toEqual({ appId: "a1", n: 3, shell: "gitbash" });
    expect(parseConsoleId("console-a1:2")).toEqual({ appId: "a1", n: 2, shell: null });
    expect(parseConsoleId(consoleId("a1"))).toEqual({ appId: "a1", n: null, shell: null });
  });
  it("reject ordinary terminal ids", () => {
    expect(parseConsoleId("2a8e1f4c-0b57-4d0e-9c1d-3e5f7a9b0c11")).toBeNull();
    expect(isConsoleId("console-")).toBe(false);
    expect(parseConsoleId("console-:1")).toBeNull();
  });
  it("next number never reuses a live one and titles are friendly", () => {
    expect(nextConsoleNumber([])).toBe(1);
    expect(nextConsoleNumber([{ id: "x", n: 1, shell: null }, { id: "y", n: 4, shell: null }])).toBe(5);
    expect(consoleTitle({ id: "x", n: 2, shell: null })).toBe("Console 2");
  });
});

describe("consoleExitAction (the guard against typing exit)", () => {
  const primary = { primary: true, msSinceAutoRestart: 60_000 };
  const extra = { primary: false, msSinceAutoRestart: 60_000 };

  it("the primary console restarts when its shell ends by itself, whatever the exit code", () => {
    expect(consoleExitAction("running", "exited", primary)).toBe("restart");
  });
  it("an extra console closes itself, like VS Code", () => {
    expect(consoleExitAction("running", "exited", extra)).toBe("remove");
  });
  it("does not restart in a loop: a shell that dies right after a restart is left with its banner", () => {
    expect(consoleExitAction("running", "exited", { primary: true, msSinceAutoRestart: RESTART_GUARD_MS - 1 })).toBe("none");
    expect(consoleExitAction("running", "exited", { primary: true, msSinceAutoRestart: RESTART_GUARD_MS })).toBe("restart");
    expect(consoleExitAction("running", "exited", { primary: false, msSinceAutoRestart: 0 })).toBe("remove");
  });
  it("leaves a user Stop, a failed start and unrelated transitions alone", () => {
    expect(consoleExitAction("running", "stopping", primary)).toBe("none");
    expect(consoleExitAction("stopping", "stopped", primary)).toBe("none");
    expect(consoleExitAction("starting", "failedToStart", primary)).toBe("none");
    expect(consoleExitAction("stopped", "exited", primary)).toBe("none");
    expect(consoleExitAction(undefined, "exited", primary)).toBe("none");
    expect(consoleExitAction("exited", "exited", primary)).toBe("none");
  });
});
