import type { Units, Wall } from "@app/schema";
import { useApp } from "@app/store";
import { getWallLength, MIN_WALL_LENGTH } from "@geometry/wall";
import clsx from "clsx";
import { useEffect, useState } from "react";
import styles from "./WallOptions.module.css";

const PRESETS = [7, 10, 12, 15, 20, 40]; // cm

export function WallOptions() {
  const tool = useApp((s) => s.tool);
  const currentWallThickness = useApp((s) => s.currentWallThickness);
  const setThickness = useApp((s) => s.setCurrentWallThickness);
  const selectedWalls = useApp((s) => s.selectedWalls);
  const walls = useApp((s) => s.plan.walls);
  const units = useApp((s) => s.plan.meta.units);

  // Length editing is a single-wall affair (see issue scope) and walls are only
  // selectable with the select tool. Gate on that tool too: a selection
  // persists across tool switches, so without it the field would leak into the
  // window/door/pan toolbars.
  const selectedWall =
    tool === "select" && selectedWalls.size === 1
      ? walls.find((w) => selectedWalls.has(w.id))
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
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= MIN_WALL_LENGTH) {
      setSelectedWallLength(parsed);
    } else {
      // Reject invalid input (non-numeric, zero, negative, below minimum):
      // leave the wall untouched and revert the field.
      setValue(String(current));
    }
  };

  return (
    <form
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
