import type { Wall } from "@app/schema";
import { useApp } from "@app/store";
import type { WallResizeAnchor } from "@geometry/wall";
import { getWallResizeContext } from "@geometry/wallResize";
import { useId, useLayoutEffect, useState } from "react";
import styles from "./WallOptions.module.css";

export function WallResizeControls({
  wall,
  walls,
  length,
}: {
  wall: Wall;
  walls: Wall[];
  length: number | null;
}) {
  const name = useId();
  const [choice, setChoice] = useState<WallResizeAnchor>("center");
  const { bothJoined, anchor } = getWallResizeContext(walls, wall, choice);
  const setEdit = useApp((s) => s.setWallLengthEdit);
  useLayoutEffect(() => {
    setEdit({ wallId: wall.id, length, anchor });
  }, [setEdit, wall.id, length, anchor]);
  useLayoutEffect(() => () => setEdit(null), [setEdit]);

  if (!bothJoined) {
    return (
      <span className={styles.resizeHint}>
        {anchor === "center" ? "Resize from center" : "Joined end stays fixed"}
      </span>
    );
  }

  const horizontal =
    Math.abs(wall.b.x - wall.a.x) >= Math.abs(wall.b.y - wall.a.y);
  const first = (horizontal ? wall.a.x <= wall.b.x : wall.a.y <= wall.b.y)
    ? "a"
    : "b";
  const options = [
    { value: first, label: horizontal ? "Left" : "Top" },
    { value: "center", label: "Center" },
    {
      value: first === "a" ? "b" : "a",
      label: horizontal ? "Right" : "Bottom",
    },
  ] as const;
  return (
    <fieldset className={styles.resizeControls} aria-label="Resize anchor">
      {options.map(({ value, label }) => (
        <label key={value} className={styles.resizeOption}>
          <input
            type="radio"
            name={name}
            aria-label={
              value === "center"
                ? "Center"
                : `Keep ${label.toLowerCase()} fixed`
            }
            checked={value === anchor}
            onChange={() => setChoice(value)}
          />
          <span>{label}</span>
        </label>
      ))}
    </fieldset>
  );
}
