import { describe, expect, it } from "vitest";
import {
  appButton,
  canStart,
  canStop,
  dotKind,
  duplicateNames,
  isExecutable,
  isUp,
  newApp,
  newTerminal,
  parseEnv,
  formatEnv,
  rollup,
  stateLabel,
  validateApp,
  type TermState,
} from "./model";

const S = (kind: TermState["kind"], extra: object = {}) => ({ kind, ...extra }) as TermState;
const stopped = S("stopped");
const running = S("running");
const detached = S("detached");
const exited0 = S("exited", { code: 0 });
const exited3 = S("exited", { code: 3 });
const failed = S("failedToStart", { reason: "nope" });

describe("state helpers", () => {
  it("canStart only from stopped, exited, failed", () => {
    expect([stopped, exited0, exited3, failed].every(canStart)).toBe(true);
    expect([S("starting"), running, detached, S("stopping")].some(canStart)).toBe(false);
  });

  it("canStop only from running or detached", () => {
    expect(canStop(running) && canStop(detached)).toBe(true);
    expect([stopped, exited0, S("starting"), S("stopping"), failed].some(canStop)).toBe(false);
  });

  it("isUp counts running, starting and detached", () => {
    expect([running, S("starting"), detached].every(isUp)).toBe(true);
    expect([stopped, exited0, exited3, failed, S("stopping")].some(isUp)).toBe(false);
  });

  it("dotKind maps each state to a distinct visual", () => {
    expect(dotKind(stopped)).toBe("grey");
    expect(dotKind(running)).toBe("green");
    expect(dotKind(detached)).toBe("greenHollow");
    expect(dotKind(S("stopping"))).toBe("amber");
    expect(dotKind(S("starting"))).toBe("amber");
    expect(dotKind(exited0)).toBe("greyTick");
    expect(dotKind(exited3)).toBe("red");
    expect(dotKind(failed)).toBe("red");
  });

  it("stateLabel is plain words and shows the exit code", () => {
    expect(stateLabel(running)).toBe("Running");
    expect(stateLabel(exited3)).toBe("Exited with code 3");
    expect(stateLabel(detached)).toMatch(/Detached/);
    expect(stateLabel(failed)).toBe("nope");
  });
});

describe("rollup", () => {
  it("matches the BRS rules", () => {
    expect(rollup([])).toBe("grey");
    expect(rollup([stopped, stopped])).toBe("grey");
    expect(rollup([running, running])).toBe("green");
    expect(rollup([detached, running])).toBe("green");
    expect(rollup([running, stopped])).toBe("amber");
    expect(rollup([running, failed])).toBe("red");
    expect(rollup([exited3, stopped])).toBe("red");
    expect(rollup([exited0, stopped])).toBe("grey");
  });
});

describe("app button", () => {
  it("shows Start all when nothing is up, Stop all otherwise", () => {
    expect(appButton([stopped, exited0])).toBe("start");
    expect(appButton([])).toBe("start");
    expect(appButton([running, stopped])).toBe("stop");
    expect(appButton([detached])).toBe("stop");
    expect(appButton([S("starting")])).toBe("stop");
  });
});

describe("the executable flag (R11)", () => {
  it("R11: a newly added terminal is executable by default", () => {
    expect(newTerminal().executable).toBe(true);
    expect(isExecutable(newTerminal())).toBe(true);
  });

  it("R11: a missing saved flag reads as executable and only an explicit false turns it off", () => {
    expect(isExecutable({ id: "a", name: "t", cwd: ".", command: "", env: {} })).toBe(true);
    expect(isExecutable({ id: "a", name: "t", cwd: ".", command: "", env: {}, executable: true })).toBe(true);
    expect(isExecutable({ id: "a", name: "t", cwd: ".", command: "", env: {}, executable: false })).toBe(false);
  });
});

describe("validation", () => {
  it("requires app and terminal names", () => {
    const a = newApp();
    a.name = " ";
    expect(validateApp(a).ok).toBe(false);
    a.name = "Qonsol";
    expect(validateApp(a).ok).toBe(true);
    const t = newTerminal();
    t.name = "";
    a.terminals = [t];
    expect(validateApp(a).ok).toBe(false);
    t.name = "api";
    expect(validateApp(a).ok).toBe(true);
  });

  it("rejects names over 40 characters", () => {
    const a = newApp();
    a.name = "x".repeat(41);
    expect(validateApp(a).ok).toBe(false);
    a.name = "x".repeat(40);
    expect(validateApp(a).ok).toBe(true);
  });

  it("warns (does not block) on duplicate terminal names", () => {
    const a = newApp();
    a.name = "A";
    const t1 = newTerminal();
    const t2 = newTerminal();
    t1.name = "api";
    t2.name = " API ";
    a.terminals = [t1, t2];
    const v = validateApp(a);
    expect(v.ok).toBe(true);
    expect(v.warnings.length).toBe(1);
    expect(duplicateNames(a.terminals)).toEqual(["api"]);
  });

  it("generates unique ids", () => {
    expect(newApp().id).not.toBe(newApp().id);
    expect(newTerminal().id).not.toBe(newTerminal().id);
  });
});

describe("env text", () => {
  it("parses NAME=value lines and ignores blanks", () => {
    expect(parseEnv("A=1\n\n B = two words \nBAD LINE\nC=x=y")).toEqual({ A: "1", B: "two words", C: "x=y" });
  });
  it("round-trips", () => {
    expect(parseEnv(formatEnv({ A: "1", B: "2" }))).toEqual({ A: "1", B: "2" });
  });
});

import {
  COMMON_COMMANDS,
  TEMPLATES,
  commandOptions,
  deriveStopCommand,
  folderOptions,
  joinPath,
  nameFromPath,
  suggestionToTerminal,
  uniqueName,
} from "./model";

describe("novice helpers", () => {
  it("derives a stop command for docker start and compose up", () => {
    expect(deriveStopCommand("docker start db")).toBe("docker stop db");
    expect(deriveStopCommand("docker  start  my-db ")).toBe("docker stop my-db");
    expect(deriveStopCommand("docker compose up")).toBe("docker compose down");
    expect(deriveStopCommand("docker compose up -d")).toBe("docker compose down");
    expect(deriveStopCommand("docker-compose up")).toBe("docker-compose down");
    expect(deriveStopCommand("npm run dev")).toBeNull();
    expect(deriveStopCommand("")).toBeNull();
  });

  it("nameFromPath takes the last folder", () => {
    expect(nameFromPath("E:\\code\\Furaha\\Qonsol")).toBe("Qonsol");
    expect(nameFromPath("E:/code/Qonsol/")).toBe("Qonsol");
    expect(nameFromPath("")).toBe("");
  });

  it("joinPath handles relative, dot and absolute folders", () => {
    expect(joinPath("E:\\q", ".")).toBe("E:\\q");
    expect(joinPath("E:\\q", "frontend")).toBe("E:\\q\\frontend");
    expect(joinPath("E:/q/", "a/b")).toBe("E:\\q\\a\\b");
    expect(joinPath("E:\\q", "D:\\other")).toBe("D:\\other");
  });

  it("folderOptions lists root, sub-folders and keeps a custom current value", () => {
    expect(folderOptions(["frontend", "backend"], ".")).toEqual([".", "frontend", "backend"]);
    expect(folderOptions(["frontend"], "D:\elsewhere")).toEqual([".", "frontend", "D:\elsewhere"]);
    expect(folderOptions([], "")).toEqual(["."]);
  });

  it("uniqueName appends a number only when needed", () => {
    expect(uniqueName("api", ["db"])).toBe("api");
    expect(uniqueName("api", ["api", "API 2"])).toBe("api 3");
  });

  it("suggestionToTerminal fills name, folder, command and stop command", () => {
    const t = suggestionToTerminal({ name: "web", cwd: "frontend", command: "npm run dev", stopCommand: null, kind: "node", primary: true });
    expect(t).toMatchObject({ name: "web", cwd: "frontend", command: "npm run dev", env: {} });
    expect(t.stopCommand).toBeUndefined();
    const d = suggestionToTerminal({ name: "c", cwd: ".", command: "docker compose up", stopCommand: "docker compose down", kind: "docker", primary: true });
    expect(d.stopCommand).toBe("docker compose down");
  });

  it("commandOptions merges detected, docker containers and common commands without duplicates", () => {
    const opts = commandOptions(
      [{ name: "x", cwd: ".", command: "npm run dev", stopCommand: null, kind: "node", primary: true }],
      ["db"],
    );
    expect(opts[0]).toBe("npm run dev");
    expect(opts).toContain("docker start db");
    expect(opts.filter((o) => o === "npm run dev")).toHaveLength(1);
    expect(COMMON_COMMANDS.length).toBeGreaterThan(5);
  });

  it("templates produce prefilled terminals", () => {
    const docker = TEMPLATES.find((t) => t.id === "docker")!.make(["pg"]);
    expect(docker).toMatchObject({ command: "docker start pg", stopCommand: "docker stop pg" });
    expect(TEMPLATES.find((t) => t.id === "shell")!.make([]).command).toBe("");
    expect(TEMPLATES.find((t) => t.id === "dotnet")!.make([]).command).toBe("dotnet watch run");
  });
});
