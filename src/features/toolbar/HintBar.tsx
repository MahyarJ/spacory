import {
  anySelection,
  hasSelectedDoor,
  hasSelectedWalls,
} from "@app/selection";
import { useApp } from "@app/store";
import { useMemo } from "react";
import styles from "./HintBar.module.css";

export function HintBar() {
  const tool = useApp((s) => s.tool);
  const selW = useApp((s) => s.selectedWalls);
  const selI = useApp((s) => s.selectedItems);
  const labelSelection = useApp((s) => s.labelSelection);
  const plan = useApp((s) => s.plan);

  const anySel = useMemo(() => anySelection(selW, selI), [selW, selI]);

  const isWallSelected = hasSelectedWalls(selW);
  const isDoorSelected = hasSelectedDoor(plan, selI);

  let text: React.ReactNode = null;

  if (tool === "select") {
    if (labelSelection) {
      text = (
        <span>
          Drag the label to move it. Press <kbd>Delete</kbd> to remove it.
        </span>
      );
    } else if (anySel) {
      text = (
        <>
          <span>Shortcuts:</span>
          {isWallSelected && (
            <>
              <kbd>[</kbd> <kbd>]</kbd> adjust wall thickness &nbsp;•&nbsp;
            </>
          )}
          {isDoorSelected && (
            <>
              <kbd>H</kbd> toggle hinge &nbsp;•&nbsp;
            </>
          )}
          {isDoorSelected && (
            <>
              <kbd>S</kbd> toggle swing &nbsp;•&nbsp;
            </>
          )}
          <kbd>Delete</kbd> remove selection
        </>
      );
    } else {
      text = (
        <span>
          Select a wall, opening, or label to edit it, or choose a room to name
          it. Shift-click to multi-select walls and items.
        </span>
      );
    }
  } else if (tool === "label") {
    text = <span>Click or tap anywhere on the plan to add a label.</span>;
  } else if (tool === "wall") {
    text = (
      <span>Click to start, click again to end a wall. Use grid snapping.</span>
    );
  } else if (tool === "window" || tool === "door") {
    text = <span>Click start and end along a wall to add a {tool}.</span>;
  }

  return text ? <div className={styles.hintbar}>{text}</div> : null;
}
