import { useApp } from "@app/store";

import clsx from "clsx";

import styles from "./Toolbar.module.css";

export function Toolbar() {
  const tool = useApp((s) => s.tool);
  const setTool = useApp((s) => s.setTool);
  const undo = useApp((s) => s.undo);
  const redo = useApp((s) => s.redo);

  return (
    <div className={styles.toolbar}>
      <h1 className={styles.brand}>Spacory</h1>
      <button
        className={clsx(styles.button, { [styles.active]: tool === "wall" })}
        onClick={() => setTool("wall")}
      >
        Wall
      </button>
      <button
        className={clsx(styles.button, { [styles.active]: tool === "select" })}
        onClick={() => setTool("select")}
      >
        Select
      </button>
      <button
        className={clsx(styles.button, { [styles.active]: tool === "pan" })}
        onClick={() => setTool("pan")}
      >
        Pan
      </button>
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
  );
}
