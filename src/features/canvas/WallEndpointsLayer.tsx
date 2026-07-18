import { useApp } from "@app/store";

/** Side length of a wall-endpoint handle, in world (cm) units at scale 1. */
const HANDLE_SIZE = 9;

/**
 * Per-wall endpoint handles, shown only when exactly one wall is selected. Drawn
 * as squares to read distinctly from the round connection-point (junction)
 * handles — a square means "move just this wall's end (detach it)", a circle
 * means "move the whole junction". Dragging one is wired in FloorPlan.
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
          <rect
            key={`we-${end}`}
            x={p.x - HANDLE_SIZE / 2}
            y={p.y - HANDLE_SIZE / 2}
            width={HANDLE_SIZE}
            height={HANDLE_SIZE}
            fill="var(--sp-bg)"
            stroke="var(--sp-accent)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </g>
  );
}
