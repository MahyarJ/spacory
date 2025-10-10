import { useApp } from "@app/store";
import styles from "./HintBar.module.css";
import { useMemo } from "react";
import {
  anySelection,
  hasSelectedDoor,
  hasSelectedWalls,
} from "@app/selection";

export function HintBar() {
  const tool = useApp((s) => s.tool);
  const selW = useApp((s) => s.selectedWalls);
  const selI = useApp((s) => s.selectedItems);
  const plan = useApp((s) => s.plan);

  const anySel = useMemo(() => anySelection(selW, selI), [selW, selI]);

  const isWallSelected = hasSelectedWalls(selW);
  const isDoorSelected = hasSelectedDoor(plan, selI);

  let text: React.ReactNode = null;

  if (tool === "select") {
    if (anySel) {
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
          Click walls or items to select. Shift-click to multi-select.
        </span>
      );
    }
  } else if (tool === "wall") {
    text = (
      <span>Click to start, click again to end a wall. Use grid snapping.</span>
    );
  } else if (tool === "window" || tool === "door") {
    text = <span>Click start and end along a wall to add a {tool}.</span>;
  }

  return text ? <div className={styles.hintbar}>{text}</div> : null;
}
