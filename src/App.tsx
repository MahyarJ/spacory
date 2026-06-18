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
        {/* Floats over the canvas so showing/hiding it never reflows it. */}
        <WallOptionsBar />
      </div>
    </div>
  );
}
