import { useApp } from "@app/store";

/** Radius of a wall-endpoint handle, in world (cm) units at scale 1. */
const HANDLE_RADIUS = 6;
/** Border weight of an endpoint handle — matches the selected-wall highlight. */
const HANDLE_STROKE = 4;

/**
 * Per-wall endpoint handles, shown only when exactly one wall is selected. Drawn
 * as circles like the connection-point (junction) handles, but larger (⌀12 vs
 * ⌀10) with the selected wall's heavier highlight border so they read clearly as
 * grabbable "pull just this wall's end (detach it)" targets. Dragging one is
 * wired in FloorPlan.
 */
export function WallEndpointsLayer() {
  const walls = useApp((s) => s.plan.walls);
  const selectedWalls = useApp((s) => s.selectedWalls);

  if (selectedWalls.size !== 1) return null;
  const [id] = selectedWalls;
  const wall = walls.find((w) => w.id === id);
  if (!wall) return null;

  return (
    <g data-layer="wall-endpoints">
      {(["a", "b"] as const).map((end) => {
        const p = wall[end];
        return (
          <circle
            key={`we-${end}`}
            cx={p.x}
            cy={p.y}
            r={HANDLE_RADIUS}
            fill="var(--sp-bg)"
            stroke="var(--sp-accent)"
            strokeWidth={HANDLE_STROKE}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </g>
  );
}
