import {
  hasSelectedDoor,
  isWallOnlySelection,
  selectionCount,
} from "@app/selection";
import { useApp } from "@app/store";
import styles from "./HintBar.module.css";

export function HintBar() {
  const tool = useApp((s) => s.tool);
  const selW = useApp((s) => s.selectedWalls);
  const selI = useApp((s) => s.selectedItems);
  const selectedLabels = useApp((s) => s.selectedLabels);
  const selectedFixtures = useApp((s) => s.selectedFixtures);
  const labelEditor = useApp((s) => s.labelEditor);
  const plan = useApp((s) => s.plan);

  const count = selectionCount(selW, selI, selectedLabels, selectedFixtures);
  const labelsOnly = count === selectedLabels.size;
  const fixturesOnly =
    selectedFixtures.size > 0 && count === selectedFixtures.size;
  const wallsOnly = isWallOnlySelection(
    selW,
    selI,
    selectedLabels,
    selectedFixtures,
  );
  const isDoorSelected = hasSelectedDoor(plan, selI);

  let text: React.ReactNode = null;

  if (labelEditor?.id) {
    text = (
      <span>
        Press <kbd>Enter</kbd> or tap away to finish. Clear the text to remove
        the label.
      </span>
    );
  } else if (tool === "select" && !fixturesOnly) {
    if (count > 0) {
      text = (
        <span>
          {labelsOnly && (
            <>
              Drag to move. {count === 1 && "Click or tap again to edit. "}
              Choose <strong>Remove</strong> or press{" "}
            </>
          )}
          {wallsOnly && (
            <>
              <kbd>[</kbd> <kbd>]</kbd> adjust wall thickness{" · "}
            </>
          )}
          {isDoorSelected && (
            <>
              <kbd>H</kbd> toggle hinge{" · "}
              <kbd>S</kbd> toggle swing{" · "}
            </>
          )}
          <kbd>Delete</kbd>
          {labelsOnly ? "." : " remove selection"}
        </span>
      );
    } else {
      text = (
        <span>
          Select a wall, opening, or label to edit it, or choose a room to name
          it. Shift-click or drag to select multiple objects.
        </span>
      );
    }
  } else if (tool === "label") {
    text = (
      <span>
        Tap the canvas to place a label. Press <kbd>Enter</kbd> to save, tap
        another spot to save and place another, or choose{" "}
        <strong>Select</strong> to finish.
      </span>
    );
  } else if (tool === "wall") {
    text = (
      <span>Click to start, click again to end a wall. Use grid snapping.</span>
    );
  } else if (tool === "window" || tool === "door") {
    text = <span>Click start and end along a wall to add a {tool}.</span>;
  }

  return text ? <div className={styles.hintbar}>{text}</div> : null;
}
