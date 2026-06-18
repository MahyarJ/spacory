import { useApp } from "@app/store";
import { WallOptions } from "./WallOptions";
import styles from "./WallOptions.module.css";

/**
 * Floating contextual bar holding the wall thickness presets (wall tool) and
 * the length editor for a single selected wall (select tool).
 *
 * Rendered as an absolutely-positioned overlay inside the canvas rather than as
 * a row in the toolbar's flex column: a row there would reflow everything below
 * it, so selecting a wall used to shove the canvas downwards. As an overlay it
 * appears and disappears without moving the canvas at all.
 */
export function WallOptionsBar() {
  const tool = useApp((s) => s.tool);
  const selectedWalls = useApp((s) => s.selectedWalls);

  const show =
    tool === "wall" || (tool === "select" && selectedWalls.size === 1);
  if (!show) return null;

  return (
    <div className={styles.bar}>
      <WallOptions />
    </div>
  );
}
