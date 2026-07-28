import { describe, expect, it } from "vitest";
import {
  isMenuSwallowedKey,
  menuMoveForKey,
  nextMenuIndex,
} from "./menuNavigation";

describe("nextMenuIndex", () => {
  it("moves to the next item", () => {
    expect(nextMenuIndex(0, 3, "next")).toBe(1);
    expect(nextMenuIndex(1, 3, "next")).toBe(2);
  });

  it("wraps from the last item to the first", () => {
    expect(nextMenuIndex(2, 3, "next")).toBe(0);
  });

  it("moves to the previous item and wraps to the last", () => {
    expect(nextMenuIndex(2, 3, "prev")).toBe(1);
    expect(nextMenuIndex(0, 3, "prev")).toBe(2);
  });

  it("jumps to the first or last item", () => {
    expect(nextMenuIndex(1, 3, "first")).toBe(0);
    expect(nextMenuIndex(1, 3, "last")).toBe(2);
  });

  it("treats no active item as before the first one", () => {
    expect(nextMenuIndex(-1, 3, "next")).toBe(0);
    expect(nextMenuIndex(-1, 3, "prev")).toBe(2);
  });

  it("has no valid index in an empty menu", () => {
    for (const move of ["next", "prev", "first", "last"] as const) {
      expect(nextMenuIndex(-1, 0, move)).toBe(-1);
    }
  });

  it("stays put in a single-item menu", () => {
    expect(nextMenuIndex(0, 1, "next")).toBe(0);
    expect(nextMenuIndex(0, 1, "prev")).toBe(0);
  });
});

describe("menuMoveForKey", () => {
  it("maps the arrow and Home/End keys", () => {
    expect(menuMoveForKey("ArrowDown")).toBe("next");
    expect(menuMoveForKey("ArrowUp")).toBe("prev");
    expect(menuMoveForKey("Home")).toBe("first");
    expect(menuMoveForKey("End")).toBe("last");
  });

  it("ignores keys the menu doesn't navigate with", () => {
    for (const key of ["Escape", "Enter", " ", "Tab", "a", "ArrowLeft"]) {
      expect(menuMoveForKey(key)).toBeNull();
    }
  });
});

describe("isMenuSwallowedKey", () => {
  it("swallows the horizontal arrows a vertical menu navigates nowhere with", () => {
    expect(isMenuSwallowedKey("ArrowLeft")).toBe(true);
    expect(isMenuSwallowedKey("ArrowRight")).toBe(true);
  });

  it("leaves everything else to the menu's own handling or the app", () => {
    for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "Escape", "a"]) {
      expect(isMenuSwallowedKey(key)).toBe(false);
    }
  });
});
