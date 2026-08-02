import type { Item, Units, Wall } from "@app/schema";
import { type SelectionAction, selectionActions } from "@app/selection";
import { useApp } from "@app/store";
import { ICON_SIZE } from "@features/toolbar/constants";
import { MIN_OPENING_WIDTH } from "@geometry/opening";
import { getWallLength, MIN_WALL_LENGTH } from "@geometry/wall";
import clsx from "clsx";
import {
  SquareCenterlineDashedHorizontal,
  SquareCenterlineDashedVertical,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { parseDraft } from "./draftField";
import { useCommitOnClickAway } from "./useCommitOnClickAway";
import styles from "./WallOptions.module.css";

const PRESETS = [7, 10, 12, 15, 20, 40]; // cm

export function WallOptions() {
  const tool = useApp((s) => s.tool);
  const currentWallThickness = useApp((s) => s.currentWallThickness);
  const setThickness = useApp((s) => s.setCurrentWallThickness);
  const selectedWalls = useApp((s) => s.selectedWalls);
  const selectedItems = useApp((s) => s.selectedItems);
  const plan = useApp((s) => s.plan);
  const { walls, items } = plan;
  const units = plan.meta.units;

  // Length editing is a single-wall affair (see issue scope) and walls are only
  // selectable with the select tool. Gate on that tool too: a selection
  // persists across tool switches, so without it the field would leak into the
  // window/door/pan toolbars.
  const selectedWall =
    tool === "select" && selectedWalls.size === 1
      ? walls.find((w) => selectedWalls.has(w.id))
      : undefined;

  // Width editing mirrors wall-length editing, but for a single selected opening
  // (door/window). Same tool gate as above, for the same reason.
  const selectedOpening =
    tool === "select" && selectedItems.size === 1
      ? items.find((i) => selectedItems.has(i.id))
      : undefined;

  // Same tool gate again: a selection outlives a tool switch, so without it the
  // action buttons would follow it into the wall/door/window/pan toolbars. The
  // keyboard shortcuts stay tool-independent — predictability beats parity.
  const actions =
    tool === "select"
      ? selectionActions(plan, selectedWalls, selectedItems)
      : [];

  return (
    <div className={styles.wallOptions}>
      {tool === "wall" && (
        <>
          <span className={styles.label}>Thickness</span>
          <div className={styles.presets}>
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                className={clsx(
                  styles.pill,
                  currentWallThickness === p && styles.active,
                )}
                onClick={() => setThickness(p)}
                title={`${p} cm`}
              >
                {p} cm
              </button>
            ))}
          </div>
        </>
      )}

      {selectedWall && (
        // Key by id so a different selection resets the field's local draft.
        <WallLengthField
          key={selectedWall.id}
          wall={selectedWall}
          units={units}
        />
      )}

      {selectedOpening && (
        // Key by id so switching selection resets the field's local draft.
        <OpeningWidthField
          key={selectedOpening.id}
          item={selectedOpening}
          units={units}
        />
      )}

      {actions.length > 0 && <SelectionActionButtons actions={actions} />}
    </div>
  );
}

/**
 * On-screen equivalents of the selection's keyboard verbs, so a tablet user can
 * edit what they drew. Each button calls the very same store action the key
 * press does, so it commits once and is one undo entry — no second write path.
 */
function SelectionActionButtons({ actions }: { actions: SelectionAction[] }) {
  const deleteSelected = useApp((s) => s.deleteSelected);
  const toggleHinge = useApp((s) => s.toggleSelectedDoorHingeEdge);
  const toggleSwing = useApp((s) => s.toggleSelectedDoorSwingSide);

  // Icon-only, so each needs an explicit accessible name; the tooltip names the
  // accelerator too, so the bar teaches the shortcut instead of replacing it.
  const config: Record<
    SelectionAction,
    { label: string; title: string; icon: React.ReactNode; onClick: () => void }
  > = {
    remove: {
      label: "Remove",
      title: "Remove (Delete)",
      icon: <Trash2 size={ICON_SIZE} />,
      onClick: deleteSelected,
    },
    // The hinge moves along the wall, the swing flips across it — hence one
    // glyph mirrored on two axes. Both families name the *split*, not the line
    // they draw: `…Horizontal` splits the square left/right about a vertical
    // dashed centerline (along the wall), `…Vertical` splits it top/bottom
    // about a horizontal one (across the wall), exactly as `FlipHorizontal2` /
    // `FlipVertical2` read before them. Keep them a pair — that axis contrast
    // is the only thing telling two 18px icon-only buttons apart.
    hinge: {
      label: "Toggle hinge",
      title: "Toggle hinge (H)",
      icon: <SquareCenterlineDashedHorizontal size={ICON_SIZE} />,
      onClick: toggleHinge,
    },
    swing: {
      label: "Toggle swing",
      title: "Toggle swing (S)",
      icon: <SquareCenterlineDashedVertical size={ICON_SIZE} />,
      onClick: toggleSwing,
    },
  };

  return (
    <div className={styles.actions}>
      {actions.map((action) => {
        const { label, title, icon, onClick } = config[action];
        return (
          <button
            key={action}
            type="button"
            className={styles.actionButton}
            aria-label={label}
            title={title}
            onClick={onClick}
          >
            {icon}
          </button>
        );
      })}
    </div>
  );
}

/** Numeric length editor for the currently selected wall. */
function WallLengthField({ wall, units }: { wall: Wall; units: Units }) {
  const setSelectedWallLength = useApp((s) => s.setSelectedWallLength);
  // Match the on-canvas label's cm precision (whole centimetres).
  const current = Math.round(getWallLength(wall));
  const [value, setValue] = useState(String(current));

  // Re-sync the draft when the wall's length changes underneath us — e.g. via
  // undo/redo while the wall stays selected.
  useEffect(() => {
    setValue(String(current));
  }, [current]);

  const commit = () => {
    const parsed = parseDraft(value, MIN_WALL_LENGTH);
    if (parsed !== null) {
      setSelectedWallLength(parsed);
    } else {
      // Reject invalid input (non-numeric, zero, negative, below minimum):
      // leave the wall untouched and revert the field.
      setValue(String(current));
    }
  };
  const fieldRef = useCommitOnClickAway(commit);

  return (
    <form
      ref={fieldRef}
      className={styles.lengthField}
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
    >
      <label className={styles.label} htmlFor="wall-length-input">
        Length
      </label>
      <input
        id="wall-length-input"
        type="number"
        inputMode="decimal"
        min={MIN_WALL_LENGTH}
        step={1}
        className={styles.lengthInput}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
      />
      <span className={styles.unit}>{units}</span>
    </form>
  );
}

/** Numeric width editor for the currently selected opening (door/window). */
function OpeningWidthField({ item, units }: { item: Item; units: Units }) {
  const setSelectedOpeningWidth = useApp((s) => s.setSelectedOpeningWidth);
  // Match the wall-length field: whole-centimetre precision.
  const current = Math.round(item.wallAttach.length);
  const [value, setValue] = useState(String(current));

  // Re-sync the draft when the width changes underneath us — e.g. via undo/redo,
  // or the on-resize reconcile clamp, while the opening stays selected.
  useEffect(() => {
    setValue(String(current));
  }, [current]);

  const commit = () => {
    const parsed = parseDraft(value, MIN_OPENING_WIDTH);
    if (parsed !== null) {
      setSelectedOpeningWidth(parsed);
    } else {
      // Reject invalid input (non-numeric, zero, negative, below minimum):
      // leave the opening untouched and revert the field.
      setValue(String(current));
    }
  };
  const fieldRef = useCommitOnClickAway(commit);

  return (
    <form
      ref={fieldRef}
      className={styles.lengthField}
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
    >
      <label className={styles.label} htmlFor="opening-width-input">
        Width
      </label>
      <input
        id="opening-width-input"
        type="number"
        inputMode="decimal"
        min={MIN_OPENING_WIDTH}
        step={1}
        className={styles.lengthInput}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
      />
      <span className={styles.unit}>{units}</span>
    </form>
  );
}
