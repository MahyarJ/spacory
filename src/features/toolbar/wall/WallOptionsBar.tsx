import { anySelection } from "@app/selection";
import { useApp } from "@app/store";
import { WallOptions } from "./WallOptions";
import styles from "./WallOptions.module.css";

/**
 * Floating contextual bar holding the wall thickness presets (wall tool) and,
 * for the select tool, the length/width editor plus the actions that apply to
 * the current selection.
 *
 * Rendered as an absolutely-positioned overlay inside the canvas rather than as
 * a row in the toolbar's flex column: a row there would reflow everything below
 * it, so selecting a wall used to shove the canvas downwards. As an overlay it
 * appears and disappears without moving the canvas at all.
 */
export function WallOptionsBar() {
  const tool = useApp((s) => s.tool);
  const selectedWalls = useApp((s) => s.selectedWalls);
  const selectedItems = useApp((s) => s.selectedItems);

  // Any non-empty selection, not just a single wall/item: the action controls
  // are the only way to delete without a keyboard, so a marquee or shift
  // multi-selection has to get a bar too.
  const show =
    tool === "wall" ||
    (tool === "select" && anySelection(selectedWalls, selectedItems));
  if (!show) return null;

  return (
    <div className={styles.bar}>
      <WallOptions />
    </div>
  );
}
