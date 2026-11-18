import { formatSystemLength, lengthToCm } from "@app/format";
import type { MeasurementSystem, Wall } from "@app/schema";
import { useApp } from "@app/store";
import { getWallLength, type WallResizeAnchor } from "@geometry/wall";
import { getWallResizeContext } from "@geometry/wallResize";
import { useId, useLayoutEffect, useState } from "react";
import styles from "./WallOptions.module.css";

export function WallResizeControls({
  wall,
  walls,
  length,
  system,
}: {
  wall: Wall;
  walls: Wall[];
  length: number | null;
  system: MeasurementSystem;
}) {
  const name = useId();
  const [choice, setChoice] = useState<WallResizeAnchor>("center");
  const { bothJoined, anchor } = getWallResizeContext(walls, wall, choice);
  const setEdit = useApp((s) => s.setWallLengthEdit);
  useLayoutEffect(() => {
    setEdit({ wallId: wall.id, length, anchor });
  }, [setEdit, wall.id, length, anchor]);
  useLayoutEffect(() => () => setEdit(null), [setEdit]);

  const horizontal =
    Math.abs(wall.b.x - wall.a.x) >= Math.abs(wall.b.y - wall.a.y);
  const first = (horizontal ? wall.a.x <= wall.b.x : wall.a.y <= wall.b.y)
    ? "a"
    : "b";
  // Each option names the moving end and stores the opposite end as its anchor.
  const firstName = horizontal ? "left" : "top";
  const lastName = horizontal ? "right" : "bottom";
  const options = [
    { value: first === "a" ? "b" : "a", label: `Move ${firstName} end` },
    { value: "center", label: "Move both ends" },
    { value: first, label: `Move ${lastName} end` },
  ] as const;
  const current = getWallLength(wall);
  const delta = length === null ? 0 : length - current;
  const distance = Math.abs(delta);
  const location =
    anchor === "center"
      ? "across both ends"
      : `at the ${anchor === first ? lastName : firstName} end`;
  const amount =
    system === "metric"
      ? distance < 0.01
        ? "<0.01 cm"
        : `${Number(distance.toFixed(2))} cm`
      : distance < lengthToCm(0.05, "in")
        ? "<0.1″"
        : formatSystemLength(distance, system);
  const summary =
    current !== 0 && delta !== 0
      ? `${delta > 0 ? "Grow" : "Shrink"} ${amount} ${location}`
      : "";

  return (
    <>
      {bothJoined ? (
        <fieldset className={styles.resizeControls} aria-label="Ends to move">
          {options.map(({ value, label }) => (
            <label key={value} className={styles.resizeOption}>
              <input
                type="radio"
                name={name}
                checked={value === anchor}
                onChange={() => setChoice(value)}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
      ) : (
        <span className={styles.resizeHint}>
          {anchor === "center"
            ? "Resize from center"
            : "Joined end stays fixed"}
        </span>
      )}
      <span className={styles.resizeSummary} role="status">
        {summary}
      </span>
    </>
  );
}
