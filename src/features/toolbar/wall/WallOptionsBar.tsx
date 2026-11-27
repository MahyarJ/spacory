import { selectionCount } from "@app/selection";
import { useApp } from "@app/store";
import { WallOptions } from "./WallOptions";
import styles from "./WallOptions.module.css";
import { WallResizeStatus } from "./WallResizeControls";

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
  const hasSelection = useApp(
    (s) =>
      selectionCount(
        s.selectedWalls,
        s.selectedItems,
        s.selectedLabels,
        s.selectedFixtures,
      ) > 0,
  );
  const isEditingLabel = useApp((s) => s.labelEditor !== null);

  // Keep the bar available for groups. During inline editing, a press outside
  // the field saves the draft, so Remove is available after the edit finishes.
  const show =
    tool === "wall" || (tool === "select" && hasSelection && !isEditingLabel);
  if (!show) return null;

  return (
    <div className={styles.overlay} data-canvas-top-controls>
      <div className={styles.bar}>
        <WallOptions />
      </div>
      <WallResizeStatus />
    </div>
  );
}
