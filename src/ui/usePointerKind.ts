import { useEffect, useState } from "react";

/** The two pointer classes the chrome distinguishes. */
export type PointerKind = "fine" | "coarse";

const COARSE_POINTER_QUERY = "(pointer: coarse)";

function readPointerKind(): PointerKind {
  // A host without matchMedia (SSR, a non-browser test host) reads as the
  // desktop default rather than guessing touch. jsdom does implement it — it
  // always reports `matches: false`, which lands on the same answer.
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return "fine";
  }
  return window.matchMedia(COARSE_POINTER_QUERY).matches ? "coarse" : "fine";
}

/**
 * The primary pointer's kind, tracked live.
 *
 * Derived here rather than added to the store: it is a property of the device,
 * not of the plan, so it has no business flowing through `commit()`.
 */
export function usePointerKind(): PointerKind {
  const [kind, setKind] = useState<PointerKind>(readPointerKind);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(COARSE_POINTER_QUERY);
    const onChange = () => setKind(query.matches ? "coarse" : "fine");
    // Re-read on mount too: plugging in a mouse (or toggling device emulation)
    // can change the answer between the first render and here.
    onChange();
    // Guarded for the same hosts the read above guards: a MediaQueryList that
    // predates (or stubs out) the EventTarget interface would throw here.
    if (typeof query.addEventListener !== "function") return;
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return kind;
}
