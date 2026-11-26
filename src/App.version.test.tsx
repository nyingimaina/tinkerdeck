import { describe, expect, it } from "vitest";

// A2: the shipped version is one number. Reading the files raw keeps this independent of the
// package tooling that writes them.
const raw = import.meta.glob(
  ["../package.json", "../package-lock.json", "../src-tauri/Cargo.toml", "../src-tauri/Cargo.lock", "../src-tauri/tauri.conf.json"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

const file = (suffix: string) => Object.entries(raw).find(([path]) => path.endsWith(suffix))?.[1] ?? "";

describe("the app version", () => {
  it("the shipped version is one number: package.json, package-lock.json, Cargo.toml, Cargo.lock and tauri.conf.json all say 2.3.0", () => {
    const version = (JSON.parse(file("package.json")) as { version: string }).version;
    expect(version).toBe("2.3.0");

    const lock = JSON.parse(file("package-lock.json")) as { version: string; packages: Record<string, { version?: string }> };
    expect(lock.version).toBe(version);
    expect(lock.packages[""].version).toBe(version);

    expect(file("src-tauri/Cargo.toml")).toContain(`version = "${version}"`);
    expect(file("src-tauri/Cargo.lock").replace(/\r\n/g, "\n")).toContain(`name = "tinkerdeck"\nversion = "${version}"`);
    expect(JSON.parse(file("src-tauri/tauri.conf.json")) as { version: string }).toHaveProperty("version", version);
  });
});
