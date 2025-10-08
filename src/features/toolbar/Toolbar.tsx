import { useApp } from "@app/store";

import clsx from "clsx";

import styles from "./Toolbar.module.css";
import { WallOptions } from "./wall/WallOptions";
import { HintBar } from "./HintBar";

export function Toolbar() {
  const tool = useApp((s) => s.tool);
  const setTool = useApp((s) => s.setTool);
  const undo = useApp((s) => s.undo);
  const redo = useApp((s) => s.redo);

  const ToolbarButton = (props: {
    tool: Parameters<typeof setTool>[0];
    label: string;
  }) => (
    <button
      className={clsx(styles.button, { [styles.active]: tool === props.tool })}
      onClick={() => setTool(props.tool)}
    >
      {props.label}
    </button>
  );

  return (
    <>
      <div className={styles.toolbar}>
        <h1 className={styles.brand}>Spacory</h1>
        <ToolbarButton tool="select" label="Select" />
        <ToolbarButton tool="wall" label="Wall" />
        <ToolbarButton tool="window" label="Window" />
        <ToolbarButton tool="door" label="Door" />
        <ToolbarButton tool="pan" label="Pan" />
        <div className={styles.spacer} />
        <button className={styles.button} onClick={undo}>
          Undo
        </button>
        <button className={styles.button} onClick={redo}>
          Redo
        </button>
        <span className={styles.label}>
          Tip: Right-drag to pan, Wheel to zoom
        </span>
      </div>
      {tool === "wall" && (
        <div className={styles.toolbar}>
          <WallOptions />
        </div>
      )}
      <HintBar />
    </>
  );
}
