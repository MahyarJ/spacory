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
    // Not a touch-gesture equivalent: those gestures don't exist yet (#84), so
    // there is nothing truthful to put in its place.
    expect(canvasHintForPointer("coarse")).toBeNull();
  });
});
