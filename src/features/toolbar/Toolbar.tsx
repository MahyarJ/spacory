import { useApp } from "@app/store";

import clsx from "clsx";
import { HintBar } from "./HintBar";
import { ProjectActions } from "./ProjectActions";
import { ThemeSwitch } from "./ThemeSwitch";
import styles from "./Toolbar.module.css";
import { WallOptions } from "./wall/WallOptions";

export function Toolbar() {
  const tool = useApp((s) => s.tool);
  const setTool = useApp((s) => s.setTool);
  const undo = useApp((s) => s.undo);
  const redo = useApp((s) => s.redo);
  const selectedWalls = useApp((s) => s.selectedWalls);

  // The wall options row carries the new-wall thickness presets (wall tool) and
  // the length editor for a single selected wall — show it when either applies.
  const showWallOptions =
    tool === "wall" || (tool === "select" && selectedWalls.size === 1);

  const ToolbarButton = (props: {
    tool: Parameters<typeof setTool>[0];
    label: string;
  }) => (
    <button
      type="button"
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
        <ProjectActions />
        <ThemeSwitch />
        <button type="button" className={styles.button} onClick={undo}>
          Undo
        </button>
        <button type="button" className={styles.button} onClick={redo}>
          Redo
        </button>
        <span className={styles.label}>
          Tip: Right-drag to pan, Wheel to zoom
        </span>
      </div>
      {showWallOptions && (
        <div className={styles.toolbar}>
          <WallOptions />
        </div>
      )}
      <HintBar />
    </>
  );
}
