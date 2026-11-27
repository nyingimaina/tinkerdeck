import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type KeyEvent = { type: string; key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean };

const h = vi.hoisted(() => ({
  handler: null as null | ((e: KeyEvent) => boolean),
  selected: false,
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options: { theme?: unknown } = {};
    cols = 80;
    rows = 24;
    loadAddon() {}
    open() {}
    attachCustomKeyEventHandler(fn: (e: KeyEvent) => boolean) {
      h.handler = fn;
    }
    onData() {}
    onBinary() {}
    write() {}
    dispose() {}
    focus() {}
    hasSelection() {
      return h.selected;
    }
    getSelection() {
      return h.selected ? "picked" : "";
    }
    clearSelection() {
      h.selected = false;
    }
    paste() {}
  },
}));

vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("../../api/tauri", () => ({
  api: { resize: vi.fn(async () => {}), writeInput: vi.fn(async () => {}) },
  attachTerminal: vi.fn(async () => {}),
}));

import { TerminalHost } from "./TerminalHost";

const writeText = vi.fn(async () => {});
const readText = vi.fn(async () => "pasted");

const key = (o: Partial<KeyEvent> & { key: string }): KeyEvent => ({
  type: "keydown",
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...o,
});

const show = async () => {
  render(<TerminalHost appId="a1" terminalId="t1" visible state={{ kind: "running" }} theme="dark" onEdit={vi.fn()} />);
  await waitFor(() => expect(h.handler).not.toBeNull());
  return h.handler as (e: KeyEvent) => boolean;
};

beforeEach(() => {
  h.handler = null;
  h.selected = false;
  writeText.mockClear();
  readText.mockClear();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText, readText },
  });
});

describe("TerminalHost app shortcuts", () => {
  it("R4: hands the app shortcuts to the window while the terminal has focus", async () => {
    const handler = await show();
    for (const e of [
      key({ key: "b", ctrlKey: true }),
      key({ key: "F5" }),
      key({ key: "p", ctrlKey: true, shiftKey: true }),
      key({ key: "t", ctrlKey: true, altKey: true }),
      key({ key: "e", ctrlKey: true, shiftKey: true }),
    ]) {
      expect(handler(e)).toBe(false);
    }
  });

  it("R9: Ctrl+Shift+E is handed to the app instead of the focused shell", async () => {
    const handler = await show();
    expect(handler(key({ key: "e", ctrlKey: true, shiftKey: true }))).toBe(false);
    // A plain or differently-modified e still belongs to the shell.
    expect(handler(key({ key: "e" }))).toBe(true);
    expect(handler(key({ key: "e", ctrlKey: true }))).toBe(true);
  });

  it("R4: leaves every other key, including the editor's, with the shell", async () => {
    const handler = await show();
    for (const e of [
      key({ key: "b" }),
      key({ key: "c", ctrlKey: true }),
      key({ key: "b", ctrlKey: true, shiftKey: true }),
      key({ key: "s", ctrlKey: true }),
      key({ key: "o", ctrlKey: true }),
      key({ key: "w", ctrlKey: true }),
    ]) {
      expect(handler(e)).toBe(true);
    }
  });

  it("A3/A5: keeps the existing Ctrl+C selection copy and Ctrl+V paste behaviour", async () => {
    const handler = await show();

    h.selected = true;
    expect(handler(key({ key: "c", ctrlKey: true }))).toBe(false);
    expect(writeText).toHaveBeenCalledWith("picked");

    h.selected = false;
    expect(handler(key({ key: "c", ctrlKey: true }))).toBe(true);

    expect(handler(key({ key: "v", ctrlKey: true }))).toBe(false);
    expect(readText).toHaveBeenCalledTimes(1);
  });
});
