import { describe, expect, it } from "vitest";
import { CANVAS_POINTER_HINT, canvasHintForPointer } from "./canvasHint";

describe("canvasHintForPointer", () => {
  it("gives a fine pointer the desktop pan/zoom tip, verbatim", () => {
    expect(canvasHintForPointer("fine")).toBe(
      "Tip: Right-drag to pan, Wheel to zoom",
    );
    expect(canvasHintForPointer("fine")).toBe(CANVAS_POINTER_HINT);
  });

  it("gives a coarse pointer no hint at all", () => {
    // The hint is desktop-only by design: right-drag and the wheel have no touch
    // counterpart, and advertising the touch gestures that replace them is a
    // separate product call.
    expect(canvasHintForPointer("coarse")).toBeNull();
  });
});
