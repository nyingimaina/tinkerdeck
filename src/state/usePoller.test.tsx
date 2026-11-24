import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePoller, type PollOptions } from "./usePoller";

function Probe<T>(props: PollOptions<T>) {
  usePoller(props);
  return null;
}

const setVisibility = (state: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
};

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe("usePoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });
  afterEach(() => vi.useRealTimers());

  it("polls immediately, reports changes, and backs off when nothing changes", async () => {
    let n = 0;
    const func = vi.fn(async () => (n < 2 ? n++ : 99)); // 0, 1, then 99 forever
    const onResult = vi.fn();
    render(<Probe func={func} onResult={onResult} intervalMs={1000} maxIntervalMs={10000} />);
    await flush(0);
    expect(func).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenLastCalledWith(0, true);
    await flush(1000);
    expect(onResult).toHaveBeenLastCalledWith(1, true);
    await flush(1000);
    expect(onResult).toHaveBeenLastCalledWith(99, true);
    await flush(1000);
    expect(onResult).toHaveBeenLastCalledWith(99, false); // unchanged: the UI can skip re-rendering
    const calls = func.mock.calls.length;
    await flush(60_000);
    // far fewer polls than one per second: backoff is working
    expect(func.mock.calls.length - calls).toBeLessThan(60);
    expect(func.mock.calls.length - calls).toBeGreaterThan(3);
  });

  it("does nothing while disabled and starts when enabled", async () => {
    const func = vi.fn(async () => 1);
    const { rerender } = render(<Probe func={func} onResult={vi.fn()} enabled={false} intervalMs={1000} />);
    await flush(10_000);
    expect(func).not.toHaveBeenCalled();
    rerender(<Probe func={func} onResult={vi.fn()} enabled intervalMs={1000} />);
    await flush(0);
    expect(func).toHaveBeenCalledTimes(1);
  });

  it("stops when the window is hidden and polls again at once when it is shown", async () => {
    const func = vi.fn(async () => 1);
    render(<Probe func={func} onResult={vi.fn()} intervalMs={1000} />);
    await flush(0);
    const before = func.mock.calls.length;
    setVisibility("hidden");
    await flush(30_000);
    expect(func.mock.calls.length).toBe(before); // nothing while hidden
    setVisibility("visible");
    await flush(0);
    expect(func.mock.calls.length).toBe(before + 1);
  });

  it("polls immediately when the window gets focus", async () => {
    const func = vi.fn(async () => 1);
    render(<Probe func={func} onResult={vi.fn()} intervalMs={5000} />);
    await flush(0);
    const before = func.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(func.mock.calls.length).toBe(before + 1);
  });

  it("refreshKey (the manual refresh button) triggers an immediate poll", async () => {
    const func = vi.fn(async () => 1);
    const { rerender } = render(<Probe func={func} onResult={vi.fn()} intervalMs={60_000} refreshKey={0} />);
    await flush(0);
    const before = func.mock.calls.length;
    rerender(<Probe func={func} onResult={vi.fn()} intervalMs={60_000} refreshKey={1} />);
    await flush(0);
    expect(func.mock.calls.length).toBe(before + 1);
    rerender(<Probe func={func} onResult={vi.fn()} intervalMs={60_000} refreshKey={1} />);
    await flush(0);
    expect(func.mock.calls.length).toBe(before + 1); // same key: no extra poll
  });

  it("stops polling on unmount and never calls back afterwards", async () => {
    const func = vi.fn(async () => 1);
    const onResult = vi.fn();
    const { unmount } = render(<Probe func={func} onResult={onResult} intervalMs={1000} />);
    await flush(0);
    unmount();
    const calls = func.mock.calls.length;
    const results = onResult.mock.calls.length;
    await flush(30_000);
    expect(func.mock.calls.length).toBe(calls);
    expect(onResult.mock.calls.length).toBe(results);
  });

  it("reports errors and stops after the maximum number of consecutive errors", async () => {
    const func = vi.fn(async () => {
      throw new Error("git is gone");
    });
    const onError = vi.fn();
    render(<Probe func={func} onResult={vi.fn()} onError={onError} intervalMs={1000} maxErrors={3} />);
    await flush(20_000);
    expect(onError).toHaveBeenCalled();
    expect(func.mock.calls.length).toBe(3);
  });

  it("uses the latest callbacks without restarting", async () => {
    const func = vi.fn(async () => 1);
    const a = vi.fn();
    const b = vi.fn();
    const { rerender } = render(<Probe func={func} onResult={a} intervalMs={1000} />);
    await flush(0);
    rerender(<Probe func={func} onResult={b} intervalMs={1000} />);
    await flush(1000);
    expect(b).toHaveBeenCalled();
    expect(func.mock.calls.length).toBe(2);
  });
});
