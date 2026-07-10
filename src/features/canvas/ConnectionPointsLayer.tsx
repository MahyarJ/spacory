import { useApp } from "@app/store";
import { getConnectionPoints, pointsEqual } from "@geometry/connectivity";
import { useMemo } from "react";

/** Radius of a connection-point handle, in world (cm) units at scale 1. */
const HANDLE_RADIUS = 5;

export function ConnectionPointsLayer() {
  const walls = useApp((s) => s.plan.walls);
  const selected = useApp((s) => s.selectedConnectionPoint);
  const points = useMemo(() => getConnectionPoints(walls), [walls]);

  return (
    <g data-layer="connection-points">
      {points.map((p) => {
        const isSelected = selected ? pointsEqual(selected, p) : false;
        return (
          <circle
            key={`cp-${p.x}-${p.y}`}
            cx={p.x}
            cy={p.y}
            r={HANDLE_RADIUS}
            fill={isSelected ? "var(--sp-accent)" : "var(--sp-bg)"}
            stroke="var(--sp-accent)"
            strokeWidth={isSelected ? 3 : 2}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </g>
  );
}
