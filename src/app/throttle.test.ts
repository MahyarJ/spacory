import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { throttle } from "./throttle";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("throttle", () => {
  it("invokes immediately on the leading edge", () => {
    const fn = vi.fn();
    const t = throttle(fn, 200);
    t("a");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith("a");
  });

  it("coalesces a burst into one trailing call with the final args", () => {
    const fn = vi.fn();
    const t = throttle(fn, 200);
    t("a"); // leading: fires now
    t("b");
    t("c"); // last value during the window
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith("c"); // resting value persisted
  });

  it("does not call more than once per delay during a steady stream", () => {
    const fn = vi.fn();
    const t = throttle(fn, 100);
    // One call every 10ms for 1s → at most ~1 per 100ms, not 100 calls.
    for (let i = 0; i < 100; i++) {
      t(i);
      vi.advanceTimersByTime(10);
    }
    expect(fn.mock.calls.length).toBeLessThanOrEqual(11);
    // The final value is always flushed.
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenLastCalledWith(99);
  });

  it("fires on the leading edge again once the window has elapsed", () => {
    const fn = vi.fn();
    const t = throttle(fn, 200);
    t("first");
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(500); // long gap, well past the window
    t("second");
    // New burst → leading edge fires synchronously, no waiting.
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith("second");
  });

  it("schedules only a single trailing timer per window", () => {
    const fn = vi.fn();
    const t = throttle(fn, 200);
    t("a"); // leading
    vi.advanceTimersByTime(50);
    t("b");
    vi.advanceTimersByTime(50);
    t("c");
    // Still within the first window; only the leading call has run.
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100); // reach 200ms since the leading run
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith("c");
  });
});
