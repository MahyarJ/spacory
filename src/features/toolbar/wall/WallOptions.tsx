import type { Item, Units, Wall } from "@app/schema";
import { useApp } from "@app/store";
import { MIN_OPENING_WIDTH } from "@geometry/opening";
import { getWallLength, MIN_WALL_LENGTH } from "@geometry/wall";
import clsx from "clsx";
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
  const walls = useApp((s) => s.plan.walls);
  const items = useApp((s) => s.plan.items);
  const units = useApp((s) => s.plan.meta.units);

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
