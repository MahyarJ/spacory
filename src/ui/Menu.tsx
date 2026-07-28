import { ChevronDown, ChevronUp } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import styles from "./Menu.module.css";
import {
  isMenuSwallowedKey,
  menuMoveForKey,
  nextMenuIndex,
} from "./menuNavigation";

/**
 * The chevron is deliberately smaller than the caller's own icons: it is an
 * affordance hint, not a peer of the label's icon, so `Menu` owns this one size
 * while the caller sizes everything it passes in.
 */
const CHEVRON_SIZE = 14;

export type MenuItem = {
  /** Stable key; also used as the React key. */
  key: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
};

type MenuProps = {
  /** Visible label on the trigger button. */
  label: string;
  /** Icon rendered before the trigger's label. */
  icon?: ReactNode;
  items: MenuItem[];
  /** Class for the trigger, so callers keep their own button styling. */
  triggerClassName?: string;
};

/**
 * Generic menu-button: a trigger that opens a floating list of actions.
 *
 * Implements the WAI-ARIA menu-button pattern in-house (see
 * `docs/DECISIONS.md`): `aria-haspopup`/`aria-expanded` on the trigger, a
 * `role="menu"` popup of `role="menuitem"` buttons, roving keyboard focus, and
 * dismissal on select / `Escape` / outside click / focus leaving the menu, with
 * focus returning to the trigger on `Escape`.
 *
 * The popup is absolutely positioned so opening it never reflows the layout
 * underneath — the same reason `WallOptionsBar` floats over the canvas.
 */
export function Menu({ label, icon, items, triggerClassName }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const close = useCallback((focusTrigger: boolean) => {
    setOpen(false);
    setActiveIndex(-1);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  // Dismiss on a click anywhere outside the menu, or on focus leaving it
  // entirely (Tab out). Both are wired as native listeners rather than JSX
  // handlers because the wrapper is a plain, non-interactive element.
  // pointerdown (not click) dismisses as soon as the press starts, rather than
  // waiting for the button to come back up. It does not shield the canvas: this
  // is a bubble-phase document listener, so the press still reaches the canvas's
  // own handler (which is attached at React's root, below document) first.
  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    const onPointerDown = (e: PointerEvent) => {
      if (!container?.contains(e.target as Node)) close(false);
    };
    const onFocusOut = (e: FocusEvent) => {
      if (!container?.contains(e.relatedTarget as Node | null)) close(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    container?.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      container?.removeEventListener("focusout", onFocusOut);
    };
  }, [open, close]);

  // Drop refs to items a caller no longer renders, then move the DOM focus to
  // whichever item the roving index points at.
  useEffect(() => {
    itemRefs.current.length = items.length;
    if (open && activeIndex >= 0) itemRefs.current[activeIndex]?.focus();
  }, [open, activeIndex, items.length]);

  // An empty menu has nothing to focus and nothing to dismiss with Escape, so
  // it simply doesn't open.
  const openAt = (move: "first" | "last") => {
    if (items.length === 0) return;
    const next = nextMenuIndex(-1, items.length, move);
    setOpen(true);
    setActiveIndex(next);
    // Already open at that very index (Shift+Tab to the trigger, then
    // ArrowDown): setActiveIndex bails out, so the focus effect never re-runs
    // and focus would be stranded on the trigger. Move it here so the arrow
    // keys always land on an item.
    if (open && next === activeIndex) itemRefs.current[next]?.focus();
  };

  // An open menu owns the keys it navigates with. Without stopping propagation
  // the native keydown keeps bubbling past React's root container to the
  // canvas's window-level shortcut listener, which only skips form fields — so
  // arrowing between entries would nudge the selected wall and push an undo
  // entry, and Escape would clear in-progress draw state.
  const consume = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const onTriggerKeyDown: React.KeyboardEventHandler = (e) => {
    // Escape must work from the trigger too: Shift+Tab out of an open popup
    // lands focus back on the trigger without closing (focus never left the
    // menu), and from there the popup's own handler can no longer be reached.
    if (e.key === "Escape" && open) {
      consume(e);
      close(true);
      return;
    }
    // While the menu is open the trigger is part of it (Shift+Tab lands here
    // without closing), so it owns the same dead keys the popup swallows. A
    // closed trigger stays a plain toolbar button and leaks them as before.
    if (open && isMenuSwallowedKey(e.key)) {
      consume(e);
      return;
    }
    // Enter/Space are left to the button's native click.
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      consume(e);
      openAt(e.key === "ArrowDown" ? "first" : "last");
    }
  };

  const onKeyDown: React.KeyboardEventHandler = (e) => {
    if (e.key === "Escape") {
      consume(e);
      close(true);
      return;
    }
    // Keys the menu navigates nowhere with but still owns while it is open —
    // otherwise they reach the canvas's shortcut listener and edit the plan.
    if (isMenuSwallowedKey(e.key)) {
      consume(e);
      return;
    }
    const move = menuMoveForKey(e.key);
    if (!move) return;
    consume(e);
    setActiveIndex(nextMenuIndex(activeIndex, items.length, move));
  };

  return (
    <div ref={containerRef} className={styles.menu}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close(false) : openAt("first"))}
        onKeyDown={onTriggerKeyDown}
      >
        {icon}
        {label}
        {/* Points at where the panel is: down to open it, up while it's open. */}
        {open ? (
          <ChevronUp size={CHEVRON_SIZE} aria-hidden="true" />
        ) : (
          <ChevronDown size={CHEVRON_SIZE} aria-hidden="true" />
        )}
      </button>
      {open && (
        <div
          className={styles.popup}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          // Keep focus on the active item when the press lands on the popup's
          // own padding or the gap between items: without this the item blurs
          // to <body>, focusout sees a null relatedTarget, and the menu closes
          // on a click that was actually inside it.
          onMouseDown={(e) => e.preventDefault()}
        >
          {items.map((item, index) => (
            <button
              key={item.key}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              type="button"
              role="menuitem"
              className={styles.item}
              tabIndex={index === activeIndex ? 0 : -1}
              // Hover moves the roving index (WAI-ARIA menu pattern), so the
              // hover highlight and the keyboard position can't disagree and an
              // arrow key continues from the entry the pointer is on.
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => {
                close(true);
                item.onSelect();
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
