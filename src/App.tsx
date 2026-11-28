import { BottomControls } from "@features/canvas/BottomControls";
import { FloorPlan } from "@features/canvas/FloorPlan";
import { Toolbar } from "@features/toolbar/Toolbar";
import { WallOptionsBar } from "@features/toolbar/wall/WallOptionsBar";
import { useState } from "react";
import styles from "./App.module.css";

export default function App() {
  const [roomOptions, setRoomOptions] = useState<HTMLDivElement | null>(null);

  return (
    <div className={styles.app}>
      <div className={styles.topControls} data-canvas-top-controls>
        <Toolbar>
          <WallOptionsBar />
          <div ref={setRoomOptions} />
        </Toolbar>
      </div>
      <FloorPlan roomOptionsContainer={roomOptions} />
      <BottomControls />
    </div>
  );
}
