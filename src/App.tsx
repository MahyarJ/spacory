import { FloorPlan } from "@features/canvas/FloorPlan";
import { ViewControls } from "@features/canvas/ViewControls";
import { Toolbar } from "@features/toolbar/Toolbar";
import { WallOptionsBar } from "@features/toolbar/wall/WallOptionsBar";
import { useLayoutEffect, useRef } from "react";
import styles from "./App.module.css";

export default function App() {
  const app = useRef<HTMLDivElement>(null);
  const topControls = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = app.current!;
    const controls = topControls.current!;
    const positionContextControls = () => {
      root.style.setProperty(
        "--sp-top-controls-end",
        `${controls.offsetTop + controls.offsetHeight}px`,
      );
    };
    positionContextControls();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(positionContextControls);
    observer.observe(controls);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={app} className={styles.app}>
      <div
        ref={topControls}
        className={styles.topControls}
        data-canvas-top-controls
      >
        <Toolbar />
      </div>
      <FloorPlan />
      <WallOptionsBar />
      <ViewControls />
    </div>
  );
}
