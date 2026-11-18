import { formatSystemLength, lengthToCm } from "@app/format";
import type { Wall } from "@app/schema";
import { useApp } from "@app/store";
import { SegmentedControl } from "@features/toolbar/SegmentedControl";
import { getWallLength, type WallResizeAnchor } from "@geometry/wall";
import { getWallResizeContext } from "@geometry/wallResize";
import { useLayoutEffect, useState } from "react";
import styles from "./WallOptions.module.css";

function wallEndPositions(wall: Wall) {
  const horizontal =
    Math.abs(wall.b.x - wall.a.x) >= Math.abs(wall.b.y - wall.a.y);
  const first = (horizontal ? wall.a.x <= wall.b.x : wall.a.y <= wall.b.y)
    ? "a"
    : "b";
  return {
    first,
    firstName: horizontal ? "Left" : "Top",
    lastName: horizontal ? "Right" : "Bottom",
  } as const;
}

export function WallResizeControls({
  wall,
  walls,
  length,
}: {
  wall: Wall;
  walls: Wall[];
  length: number | null;
}) {
  const [choice, setChoice] = useState<WallResizeAnchor>();
  const { anchor } = getWallResizeContext(walls, wall, choice);
  const setEdit = useApp((s) => s.setWallLengthEdit);
  useLayoutEffect(() => {
    setEdit({ wallId: wall.id, length, anchor });
  }, [setEdit, wall.id, length, anchor]);
  useLayoutEffect(() => () => setEdit(null), [setEdit]);

  const { first, firstName, lastName } = wallEndPositions(wall);
  // Each option names the moving end and stores the opposite end as its anchor.
  const options = [
    { value: first === "a" ? "b" : "a", label: firstName },
    { value: "center", label: "Both" },
    { value: first, label: lastName },
  ] as const;
  return (
    <div className={styles.moveControls}>
      <span className={styles.label} aria-hidden="true">
        Move
      </span>
      <SegmentedControl
        label="Move"
        options={options}
        value={anchor}
        onChange={setChoice}
      />
    </div>
  );
}

export function WallResizeStatus() {
  const edit = useApp((s) => s.wallLengthEdit);
  const plan = useApp((s) => s.plan);
  const wall = edit && plan.walls.find((w) => w.id === edit.wallId);
  let summary = "";
  if (wall && edit.length !== null) {
    const current = getWallLength(wall);
    const delta = edit.length - current;
    const { measurementSystem: system } = plan.meta;
    if (current !== 0 && delta !== 0) {
      const { first, firstName, lastName } = wallEndPositions(wall);
      const movingEnd = edit.anchor === first ? lastName : firstName;
      const location =
        edit.anchor === "center"
          ? "across both ends"
          : `at the ${movingEnd.toLowerCase()} end`;
      const formatLength = (cm: number) =>
        system === "metric"
          ? `${Number(cm.toFixed(2))} cm`
          : formatSystemLength(cm, system);
      const distance = Math.abs(delta);
      const smallAmount = system === "metric" ? "<0.01 cm" : "<0.1″";
      const minimum = system === "metric" ? 0.01 : lengthToCm(0.05, "in");
      const amount = distance < minimum ? smallAmount : formatLength(distance);
      summary = `${delta > 0 ? "Grow" : "Shrink"} by ${amount} ${location} (${formatLength(current)} → ${formatLength(edit.length)})`;
    }
  }

  return (
    <div className={styles.resizeSummary} role="status">
      {summary}
    </div>
  );
}
