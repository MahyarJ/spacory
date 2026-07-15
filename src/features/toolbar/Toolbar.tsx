import { useApp } from "@app/store";

import clsx from "clsx";
import {
  DoorOpen,
  Maximize,
  MousePointer2,
  Move,
  Redo2,
  Undo2,
} from "lucide-react";
import type { ComponentType } from "react";
import { HintBar } from "./HintBar";
import { WallIcon, WindowIcon } from "./icons";
import { ProjectActions } from "./ProjectActions";
import { ThemeSwitch } from "./ThemeSwitch";
import styles from "./Toolbar.module.css";

/** Shared props between lucide-react icons and our domain glyphs. */
type IconComponent = ComponentType<{ size?: string | number }>;

const ICON_SIZE = 18;

export function Toolbar() {
  const tool = useApp((s) => s.tool);
  const setTool = useApp((s) => s.setTool);
  const undo = useApp((s) => s.undo);
  const redo = useApp((s) => s.redo);
  const fitView = useApp((s) => s.fitView);

  const ToolbarButton = (props: {
    tool: Parameters<typeof setTool>[0];
    label: string;
    icon: IconComponent;
  }) => {
    const Icon = props.icon;
    return (
      <button
        type="button"
        className={clsx(styles.button, {
          [styles.active]: tool === props.tool,
        })}
        onClick={() => setTool(props.tool)}
      >
        <Icon size={ICON_SIZE} />
        {props.label}
      </button>
    );
  };

  return (
    <>
      <div className={styles.toolbar}>
        <h1 className={styles.brand}>Spacory</h1>
        <ToolbarButton tool="select" label="Select" icon={MousePointer2} />
        <ToolbarButton tool="wall" label="Wall" icon={WallIcon} />
        <ToolbarButton tool="window" label="Window" icon={WindowIcon} />
        <ToolbarButton tool="door" label="Door" icon={DoorOpen} />
        <ToolbarButton tool="pan" label="Pan" icon={Move} />
        <button
          type="button"
          className={styles.button}
          onClick={fitView}
          title="Frame the whole plan in view"
        >
          <Maximize size={ICON_SIZE} />
          Fit
        </button>
        <div className={styles.spacer} />
        <ProjectActions />
        <ThemeSwitch />
        <button type="button" className={styles.button} onClick={undo}>
          <Undo2 size={ICON_SIZE} />
          Undo
        </button>
        <button type="button" className={styles.button} onClick={redo}>
          <Redo2 size={ICON_SIZE} />
          Redo
        </button>
        <span className={styles.label}>
          Tip: Right-drag to pan, Wheel to zoom
        </span>
      </div>
      <HintBar />
    </>
  );
}
