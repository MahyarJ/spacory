import { selectionCount } from "@app/selection";
import { useApp } from "@app/store";
import optionsStyles from "@ui/OptionsPanel.module.css";
import { WallOptions } from "./WallOptions";
import styles from "./WallOptions.module.css";
import { WallResizeStatus } from "./WallResizeControls";

/**
 * Floating contextual bar holding the wall thickness presets (wall tool) and,
 * for the select tool, the length/width editor plus the actions that apply to
 * the current selection.
 *
 * The floating toolbar places these controls below the project actions.
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
      <div className={`${optionsStyles.panel} ${styles.bar}`}>
        <WallOptions />
      </div>
      <WallResizeStatus />
    </div>
  );
}
