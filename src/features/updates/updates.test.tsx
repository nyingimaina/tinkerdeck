import { act, renderHook, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateBanner, UpdateDialog, UpdateSettingsBlock } from "./UpdateUI";
import { useUpdates } from "../../state/useUpdates";
import type { UpdateInfo } from "../../state/model";

const h = vi.hoisted(() => ({
  progressCb: null as null | ((p: { done: number; total: number }) => void),
  api: {
    checkUpdate: vi.fn(),
    downloadUpdate: vi.fn(),
    applyUpdate: vi.fn(),
  },
}));

vi.mock("../../api/tauri", () => ({
  api: h.api,
  errorText: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  onUpdateProgress: vi.fn(async (cb: (p: { done: number; total: number }) => void) => {
    h.progressCb = cb;
    return () => {
      h.progressCb = null;
    };
  }),
}));

const info: UpdateInfo = { version: "1.3.0", notes: "Faster.\nFewer bugs.", url: "https://x/y.exe", sha256: "a".repeat(64), size: 4_200_000 };

beforeEach(() => {
  h.api.checkUpdate.mockReset().mockResolvedValue(null);
  h.api.downloadUpdate.mockReset().mockResolvedValue("C:\\x.exe");
  h.api.applyUpdate.mockReset().mockResolvedValue(undefined);
});

const setup = (opts: { autoCheck?: boolean; skippedVersion?: string | null } = {}) => {
  const save = vi.fn(async () => {});
  const r = renderHook(
    (p: { autoCheck: boolean; skippedVersion?: string | null }) => useUpdates({ autoCheck: p.autoCheck, skippedVersion: p.skippedVersion, save }),
    { initialProps: { autoCheck: opts.autoCheck ?? true, skippedVersion: opts.skippedVersion } },
  );
  return { ...r, save };
};

describe("useUpdates", () => {
  it("a quiet check at start shows the banner when a newer version exists", async () => {
    h.api.checkUpdate.mockResolvedValue(info);
    const { result } = setup();
    await waitFor(() => expect(result.current.visible).toBe(true));
    expect(result.current.info?.version).toBe("1.3.0");
    expect(h.api.checkUpdate).toHaveBeenCalledWith(false);
  });

  it("does not look when automatic checks are off", async () => {
    setup({ autoCheck: false });
    await new Promise((r) => setTimeout(r, 100));
    expect(h.api.checkUpdate).not.toHaveBeenCalled();
  });

  it("a skipped version stays hidden, Later hides it for the session, a different version shows again", async () => {
    h.api.checkUpdate.mockResolvedValue(info);
    const skipped = setup({ skippedVersion: "1.3.0" });
    await waitFor(() => expect(skipped.result.current.info).not.toBeNull());
    expect(skipped.result.current.visible).toBe(false);

    const later = setup();
    await waitFor(() => expect(later.result.current.visible).toBe(true));
    act(() => later.result.current.later());
    expect(later.result.current.visible).toBe(false);

    const other = setup({ skippedVersion: "1.2.5" });
    await waitFor(() => expect(other.result.current.visible).toBe(true));
  });

  it("skip saves the version", async () => {
    h.api.checkUpdate.mockResolvedValue(info);
    const { result, save } = setup();
    await waitFor(() => expect(result.current.visible).toBe(true));
    await act(async () => result.current.skip());
    expect(save).toHaveBeenCalledWith({ skippedVersion: "1.3.0" });
  });

  it("a manual check forces the request, reports up to date, and shows errors", async () => {
    const { result } = setup({ autoCheck: false });
    await act(async () => result.current.checkNow());
    expect(h.api.checkUpdate).toHaveBeenCalledWith(true);
    expect(result.current.upToDate).toBe(true);
    h.api.checkUpdate.mockRejectedValue("Could not reach the update server.");
    await act(async () => result.current.checkNow());
    expect(result.current.error).toBe("Could not reach the update server.");
    expect(result.current.upToDate).toBe(false);
    expect(result.current.phase).toBe("idle");
  });

  it("a manual check un-skips a version it finds", async () => {
    h.api.checkUpdate.mockResolvedValue(info);
    const { result, save } = setup({ autoCheck: false, skippedVersion: "1.3.0" });
    await act(async () => result.current.checkNow());
    expect(save).toHaveBeenCalledWith({ skippedVersion: null });
  });

  it("install downloads with progress and then applies, in that order", async () => {
    h.api.checkUpdate.mockResolvedValue(info);
    const order: string[] = [];
    h.api.downloadUpdate.mockImplementation(async () => {
      order.push("download");
      h.progressCb?.({ done: 1_000_000, total: 4_200_000 });
      await new Promise((r) => setTimeout(r, 10));
      return "C:\\x.exe";
    });
    h.api.applyUpdate.mockImplementation(async () => void order.push("apply"));
    const { result } = setup();
    await waitFor(() => expect(result.current.info).not.toBeNull());
    await act(async () => result.current.install());
    expect(order).toEqual(["download", "apply"]);
    expect(result.current.phase).toBe("installing"); // the app is about to exit; no spinner reset
    expect(result.current.progress).toEqual({ done: 1_000_000, total: 4_200_000 });
  });

  it("a failed download is reported and nothing is applied", async () => {
    h.api.checkUpdate.mockResolvedValue(info);
    h.api.downloadUpdate.mockRejectedValue("The downloaded update does not match its checksum and was discarded.");
    const { result } = setup();
    await waitFor(() => expect(result.current.info).not.toBeNull());
    await act(async () => result.current.install());
    expect(result.current.error).toContain("checksum");
    expect(result.current.phase).toBe("idle");
    expect(h.api.applyUpdate).not.toHaveBeenCalled();
  });
});

describe("update UI", () => {
  it("the banner names the version and offers the four choices", async () => {
    const h2 = { onDetails: vi.fn(), onLater: vi.fn(), onSkip: vi.fn() };
    render(<UpdateBanner info={info} {...h2} />);
    expect(screen.getByRole("alert")).toHaveTextContent("1.3.0 is available");
    await userEvent.click(screen.getByRole("button", { name: "Update now" }));
    await userEvent.click(screen.getByRole("button", { name: "Later" }));
    await userEvent.click(screen.getByRole("button", { name: "Skip this version" }));
    expect([h2.onDetails, h2.onLater, h2.onSkip].every((f) => f.mock.calls.length === 1)).toBe(true);
  });

  const dialog = (over: Partial<React.ComponentProps<typeof UpdateDialog>> = {}) => {
    const h2 = { onInstall: vi.fn(), onClose: vi.fn() };
    render(<UpdateDialog info={info} phase="idle" progress={null} error={null} runningCount={0} {...h2} {...over} />);
    return h2;
  };

  it("the dialog shows notes and size and installs on confirm", async () => {
    const h2 = dialog();
    expect(screen.getByRole("dialog", { name: "Update to 1.3.0" })).toBeInTheDocument();
    expect(screen.getByText(/Fewer bugs/)).toBeInTheDocument();
    expect(screen.getByText(/4\.0 MB/)).toBeInTheDocument();
    expect(screen.queryByText(/terminal/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Update and restart" }));
    expect(h2.onInstall).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(h2.onClose).toHaveBeenCalled();
  });

  it("it warns about running terminals, singular and plural", () => {
    dialog({ runningCount: 1 });
    expect(screen.getByText(/1 terminal is running/)).toBeInTheDocument();
  });

  it("plural warning mentions the restore offer", () => {
    dialog({ runningCount: 3 });
    expect(screen.getByText(/3 terminals are running/)).toHaveTextContent(/offers to start the apps that were running/);
  });

  it("while downloading it shows progress and hides the buttons; while installing it says so", () => {
    const { unmount } = render(
      <UpdateDialog info={info} phase="downloading" progress={{ done: 2_100_000, total: 4_200_000 }} error={null} runningCount={0} onInstall={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByRole("progressbar", { name: "Downloading update" })).toHaveAttribute("value", "50");
    expect(screen.getByText("Downloading… 50%")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Update and restart" })).toBeNull();
    unmount();
    render(<UpdateDialog info={info} phase="installing" progress={null} error={null} runningCount={0} onInstall={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Installing");
  });

  it("an error is shown and the buttons come back so it can be retried", () => {
    dialog({ error: "Could not reach the update server." });
    expect(screen.getByRole("alert")).toHaveTextContent("Could not reach");
    expect(screen.getByRole("button", { name: "Update and restart" })).toBeEnabled();
  });

  it("the settings block shows the version, the automatic switch and the status of a check", async () => {
    const onAutoCheck = vi.fn();
    const onCheckNow = vi.fn();
    const { rerender } = render(
      <UpdateSettingsBlock version="1.2.0" autoCheck phase="idle" upToDate={false} available={null} error={null} onAutoCheck={onAutoCheck} onCheckNow={onCheckNow} />,
    );
    expect(screen.getByText("Version 1.2.0")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/Check for updates automatically/));
    expect(onAutoCheck).toHaveBeenCalledWith(false);
    await userEvent.click(screen.getByRole("button", { name: "Check now" }));
    expect(onCheckNow).toHaveBeenCalled();
    rerender(<UpdateSettingsBlock version="1.2.0" autoCheck phase="idle" upToDate available={null} error={null} onAutoCheck={onAutoCheck} onCheckNow={onCheckNow} />);
    expect(screen.getByRole("status")).toHaveTextContent("You are up to date.");
    rerender(<UpdateSettingsBlock version="1.2.0" autoCheck phase="idle" upToDate={false} available="1.3.0" error={null} onAutoCheck={onAutoCheck} onCheckNow={onCheckNow} />);
    expect(screen.getByRole("status")).toHaveTextContent("Version 1.3.0 is available.");
    rerender(<UpdateSettingsBlock version="1.2.0" autoCheck phase="idle" upToDate={false} available={null} error="Could not reach the update server." onAutoCheck={onAutoCheck} onCheckNow={onCheckNow} />);
    expect(screen.getByRole("status")).toHaveTextContent("Could not reach");
    rerender(<UpdateSettingsBlock version="1.2.0" autoCheck phase="checking" upToDate={false} available={null} error={null} onAutoCheck={onAutoCheck} onCheckNow={onCheckNow} />);
    expect(screen.getByRole("button", { name: "Check now" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Checking…");
  });
});
