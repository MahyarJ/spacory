import { ChevronDown } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import styles from "./Menu.module.css";
import { menuMoveForKey, nextMenuIndex } from "./menuNavigation";

export type MenuItem = {
  /** Stable key; also used as the React key. */
  key: string;
  label: string;
  /** Optional one-word clarification shown next to the label. */
  hint?: string;
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
  // pointerdown (not click) closes the menu before the click lands on the
  // canvas below.
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

  // Move the DOM focus to whichever item the roving index points at.
  useEffect(() => {
    if (open && activeIndex >= 0) itemRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  const openAt = (move: "first" | "last") => {
    setOpen(true);
    setActiveIndex(nextMenuIndex(-1, items.length, move));
  };

  const onTriggerKeyDown: React.KeyboardEventHandler = (e) => {
    // Enter/Space are left to the button's native click.
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openAt(e.key === "ArrowDown" ? "first" : "last");
    }
  };

  const onKeyDown: React.KeyboardEventHandler = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
      return;
    }
    const move = menuMoveForKey(e.key);
    if (!move) return;
    e.preventDefault();
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
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div
          className={styles.popup}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
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
              onClick={() => {
                close(true);
                item.onSelect();
              }}
            >
              {item.icon}
              <span className={styles.itemLabel}>{item.label}</span>
              {item.hint && (
                <span className={styles.itemHint}>{item.hint}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
