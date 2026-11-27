import type { FixtureType } from "@app/schema";
import { type Tool, useApp } from "@app/store";
import { ICON_SIZE } from "@ui/constants";
import { Menu } from "@ui/Menu";
import { SinkIcon } from "@ui/SinkSymbol";
import {
  BrickWall,
  DoorOpen,
  Grid2x2,
  Hand,
  MousePointer2,
  Redo2,
  Type,
  Undo2,
} from "lucide-react";
import type { ComponentType } from "react";
import { useState } from "react";
import { EditorSettings } from "./EditorSettings";
import { HintBar } from "./HintBar";
import { ProjectActions } from "./ProjectActions";
import styles from "./Toolbar.module.css";

type DrawingTool = {
  tool: Tool;
  label: string;
  icon: ComponentType<{ size?: string | number }>;
};

type FixtureTool = DrawingTool & { tool: FixtureType };

const fixtures: [FixtureTool, ...FixtureTool[]] = [
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

function FixturePicker() {
  const tool = useApp((s) => s.tool);
  const setTool = useApp((s) => s.setTool);
  const [lastFixture, setLastFixture] = useState(fixtures[0]);
  const current =
    fixtures.find((fixture) => fixture.tool === tool) ?? lastFixture;

  return (
    <div className={styles.fixturePicker}>
      <ToolButton {...current} />
      <Menu
        label="Fixtures"
        chevronOnly
        triggerClassName={`${styles.iconButton} ${styles.fixtureChevron}`}
        items={fixtures.map((fixture) => {
          const Icon = fixture.icon;
          return {
            key: fixture.tool,
            label: fixture.label,
            icon: <Icon size={ICON_SIZE} />,
            checked: fixture.tool === current.tool,
            onSelect: () => {
              setLastFixture(fixture);
              setTool(fixture.tool);
            },
          };
        })}
      />
    </div>
  );
}

export function Toolbar() {
  const undo = useApp((s) => s.undo);
  const redo = useApp((s) => s.redo);

  return (
    <>
      <div className={styles.toolbar}>
        <h1 className={styles.wordmark}>Spacory</h1>
        <fieldset
          className={`${styles.panel} ${styles.tools}`}
          aria-label="Drawing tools"
        >
          <ToolButton tool="select" label="Select" icon={MousePointer2} />
          <ToolButton tool="pan" label="Pan" icon={Hand} />
          <ToolButton tool="wall" label="Wall" icon={BrickWall} />
          <ToolButton tool="door" label="Door" icon={DoorOpen} />
          <ToolButton tool="window" label="Window" icon={Grid2x2} />
          <div className={styles.insertionTools}>
            <FixturePicker />
            <ToolButton tool="label" label="Label" icon={Type} />
          </div>
        </fieldset>
        <div className={styles.commands}>
          <fieldset className={styles.panel} aria-label="Edit history">
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
          </fieldset>
          <fieldset className={styles.panel} aria-label="Project actions">
            <ProjectActions />
            <EditorSettings />
          </fieldset>
        </div>
      </div>
      <HintBar />
    </>
  );
}
