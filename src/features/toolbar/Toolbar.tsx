import { type Tool, useApp } from "@app/store";
import { ICON_SIZE } from "@ui/constants";
import { Menu } from "@ui/Menu";
import { createPlanLabelMeasurer } from "@ui/planLabelMeasurer";
import { SinkIcon } from "@ui/SinkSymbol";
import {
  Bath,
  BrickWall,
  DoorOpen,
  Grid2x2,
  Hand,
  Maximize,
  MousePointer2,
  Redo2,
  Type,
  Undo2,
} from "lucide-react";
import type { ComponentType } from "react";
import { EditorSettings } from "./EditorSettings";
import { HintBar } from "./HintBar";
import { ProjectActions } from "./ProjectActions";
import styles from "./Toolbar.module.css";

type DrawingTool = {
  tool: Tool;
  label: string;
  icon: ComponentType<{ size?: string | number }>;
};

const openings: DrawingTool[] = [
  { tool: "door", label: "Door", icon: DoorOpen },
  { tool: "window", label: "Window", icon: Grid2x2 },
];

const fixtures: DrawingTool[] = [
  { tool: "sink", label: "Sink", icon: SinkIcon },
];

function ToolButton({ tool, label, icon: Icon }: DrawingTool) {
  const active = useApp((s) => s.tool === tool);
  const setTool = useApp((s) => s.setTool);

  return (
    <button
      type="button"
      className={styles.iconButton}
      onClick={() => setTool(tool)}
      aria-label={label}
      aria-pressed={active}
      title={label}
    >
      <Icon size={ICON_SIZE} />
    </button>
  );
}

function ToolMenu({
  label,
  icon: Icon,
  tools,
}: Pick<DrawingTool, "label" | "icon"> & { tools: DrawingTool[] }) {
  const tool = useApp((s) => s.tool);
  const setTool = useApp((s) => s.setTool);

  return (
    <Menu
      label={label}
      icon={<Icon size={ICON_SIZE} />}
      iconOnly
      triggerClassName={styles.iconButton}
      items={tools.map(({ tool: value, label, icon: ItemIcon }) => ({
        key: value,
        label,
        icon: <ItemIcon size={ICON_SIZE} />,
        checked: tool === value,
        onSelect: () => setTool(value),
      }))}
    />
  );
}

export function Toolbar() {
  const undo = useApp((s) => s.undo);
  const redo = useApp((s) => s.redo);
  const fitView = useApp((s) => s.fitView);

  return (
    <>
      <header className={styles.toolbar}>
        <div className={styles.brandGroup}>
          <EditorSettings />
          <h1 className={styles.brand}>Spacory</h1>
        </div>
        <fieldset className={styles.tools} aria-label="Drawing tools">
          <ToolButton tool="select" label="Select" icon={MousePointer2} />
          <ToolButton tool="pan" label="Pan" icon={Hand} />
          <div className={styles.divider} aria-hidden="true" />
          <ToolButton tool="wall" label="Wall" icon={BrickWall} />
          <ToolMenu label="Openings" icon={DoorOpen} tools={openings} />
          <ToolMenu label="Fixtures" icon={Bath} tools={fixtures} />
          <ToolButton tool="label" label="Label" icon={Type} />
        </fieldset>
        <fieldset className={styles.actions} aria-label="Editor actions">
          <button
            type="button"
            className={styles.iconButton}
            onClick={undo}
            aria-label="Undo"
            title="Undo"
          >
            <Undo2 size={ICON_SIZE} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            onClick={redo}
            aria-label="Redo"
            title="Redo"
          >
            <Redo2 size={ICON_SIZE} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => fitView(createPlanLabelMeasurer())}
            aria-label="Fit plan in view"
            title="Fit plan in view"
          >
            <Maximize size={ICON_SIZE} aria-hidden="true" />
          </button>
          <div className={styles.divider} aria-hidden="true" />
          <ProjectActions />
        </fieldset>
      </header>
      <HintBar />
    </>
  );
}
