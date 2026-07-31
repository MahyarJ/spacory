import { CanvasHint } from "@features/canvas/CanvasHint";
import { FloorPlan } from "@features/canvas/FloorPlan";
import { Toolbar } from "@features/toolbar/Toolbar";
import { WallOptionsBar } from "@features/toolbar/wall/WallOptionsBar";

import styles from "./App.module.css";

export default function App() {
  return (
    <div className={styles.app}>
      <Toolbar />
      <div className={styles.canvasWrap}>
        <FloorPlan />
        {/* Both float over the canvas so showing/hiding them never reflows it:
            the wall options at the top-left, the pan/zoom tip bottom-right. */}
        <WallOptionsBar />
        <CanvasHint />
      </div>
    </div>
  );
}
