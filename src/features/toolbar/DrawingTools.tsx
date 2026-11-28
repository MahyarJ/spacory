import type { FixtureType } from "@app/schema";
import { type Tool, useApp } from "@app/store";
import { IconButton } from "@ui/Button";
import { ICON_SIZE } from "@ui/constants";
import { FloatingBar } from "@ui/FloatingBar";
import { Menu } from "@ui/Menu";
import { SinkIcon } from "@ui/SinkSymbol";
import {
  BrickWall,
  DoorOpen,
  Grid2x2,
  Hand,
  MousePointer2,
  Type,
} from "lucide-react";
import { type ComponentType, useState } from "react";
import styles from "./DrawingTools.module.css";

type DrawingTool = {
  tool: Tool;
  label: string;
  icon: ComponentType<{ size?: string | number }>;
};

type FixtureTool = DrawingTool & { tool: FixtureType };

const fixtures: [FixtureTool, ...FixtureTool[]] = [
  { tool: "sink", label: "Sink", icon: SinkIcon },
];

function ToolButton({
  tool,
  label,
  icon: Icon,
  className,
}: DrawingTool & { className?: string }) {
  const active = useApp((s) => s.tool === tool);
  const setTool = useApp((s) => s.setTool);

  return (
    <IconButton
      className={className}
      label={label}
      aria-pressed={active}
      onClick={() => setTool(tool)}
    >
      <Icon size={ICON_SIZE} />
    </IconButton>
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
      <ToolButton {...current} className={styles.fixtureTool} />
      <Menu
        label="Fixtures"
        chevronOnly
        triggerClassName={styles.fixtureChevron}
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

export function DrawingTools({ className }: { className?: string }) {
  return (
    <FloatingBar aria-label="Drawing tools" className={className}>
      <ToolButton tool="select" label="Select" icon={MousePointer2} />
      <ToolButton tool="pan" label="Pan" icon={Hand} />
      <ToolButton tool="wall" label="Wall" icon={BrickWall} />
      <ToolButton tool="door" label="Door" icon={DoorOpen} />
      <ToolButton tool="window" label="Window" icon={Grid2x2} />
      <div className={styles.insertionTools}>
        <FixturePicker />
        <ToolButton tool="label" label="Label" icon={Type} />
      </div>
    </FloatingBar>
  );
}
