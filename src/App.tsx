import { Toolbar } from "@features/toolbar/Toolbar";
import { FloorPlan } from "@features/canvas/FloorPlan";

import styles from "./App.module.css";

export default function App() {
  return (
    <div className={styles.app}>
      <Toolbar />
      <div className={styles.canvasWrap}>
        <FloorPlan />
      </div>
    </div>
  );
}
