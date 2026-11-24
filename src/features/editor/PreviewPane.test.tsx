import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ readBytes: vi.fn() }));
vi.mock("../../api/editor", () => ({ editorApi: { readBytes: h.readBytes } }));

import PreviewPane from "./PreviewPane";

const created: Blob[] = [];
const revoked: string[] = [];

beforeEach(() => {
  h.readBytes.mockReset();
  created.length = 0;
  revoked.length = 0;
  (URL as unknown as Record<string, unknown>).createObjectURL = (b: Blob) => {
    created.push(b);
    return `blob:test/${created.length}`;
  };
  (URL as unknown as Record<string, unknown>).revokeObjectURL = (u: string) => revoked.push(u);
});

describe("PreviewPane", () => {
  it("renders markdown and strips anything dangerous", async () => {
    render(<PreviewPane kind="markdown" title="a.md" path={null} content={"# Hello\n\nsome **bold**\n\n<script>alert(1)</script>\n<img src=x onerror=alert(2)>"} />);
    expect((await screen.findByRole("heading", { name: "Hello", level: 1 })).tagName).toBe("H1");
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    const html = document.body.innerHTML;
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
  });

  it("shows html in a sandbox that cannot run scripts or touch the app", () => {
    render(<PreviewPane kind="html" title="a.html" path={null} content="<h1>Hi</h1>" />);
    const frame = screen.getByTitle("Preview of a.html") as HTMLIFrameElement;
    expect(frame.getAttribute("srcdoc")).toBe("<h1>Hi</h1>");
    expect(frame.getAttribute("sandbox")).toBe("");
  });

  it("shows svg as an image, so its scripts never run", () => {
    render(<PreviewPane kind="svg" title="a.svg" path={null} content={'<svg xmlns="http://www.w3.org/2000/svg"/>'} />);
    const img = screen.getByAltText("Preview of a.svg") as HTMLImageElement;
    expect(img.getAttribute("src")).toMatch(/^blob:/);
    expect(created[0].type).toBe("image/svg+xml");
  });

  it("loads an image from its file and releases it afterwards", async () => {
    h.readBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
    const { unmount } = render(<PreviewPane kind="image" title="p.png" path="C:/x/p.png" content="" />);
    const img = (await screen.findByAltText("Preview of p.png")) as HTMLImageElement;
    expect(h.readBytes).toHaveBeenCalledWith("C:/x/p.png");
    expect(img.getAttribute("src")).toBe("blob:test/1");
    expect(created[0].type).toBe("image/png");
    unmount();
    expect(revoked).toContain("blob:test/1");
  });

  it("shows a pdf in a frame", async () => {
    h.readBytes.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
    render(<PreviewPane kind="pdf" title="m.pdf" path="C:/x/m.pdf" content="" />);
    const frame = (await screen.findByTitle("Preview of m.pdf")) as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toMatch(/^blob:/);
    expect(created[0].type).toBe("application/pdf");
  });

  it("says plainly when the file cannot be loaded", async () => {
    h.readBytes.mockRejectedValue("The file was not found: C:/x/gone.png");
    render(<PreviewPane kind="image" title="gone.png" path="C:/x/gone.png" content="" />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("not found"));
  });
});
