import { useApp } from "@app/store";
import { computeWallGeometry, polygonToPoints } from "@geometry/junction";
import { getWallAngle, getWallLength } from "@geometry/wall";

export function WallResizePreview() {
  const edit = useApp((s) => s.wallLengthEdit);
  const plan = useApp((s) => s.plan);
  const selection = useApp((s) => s.selectedWalls);
  const tool = useApp((s) => s.tool);
  const scale = useApp((s) => s.view.scale);
  if (
    !edit ||
    tool !== "select" ||
    selection.size !== 1 ||
    !selection.has(edit.wallId)
  ) {
    return null;
  }
  const wall = plan.walls.find((w) => w.id === edit.wallId);
  if (!wall) return null;
  const length = getWallLength(wall);
  if (length === 0) return null;

  if (edit.preview === "blocked-junction") return null;
  const preview = edit.preview;
  const polygons = preview && computeWallGeometry(preview).walls;
  const unchanged = new Set(plan.walls);
  const shrinking = preview && edit.length !== null && edit.length < length;
  const angle = (getWallAngle(wall) * 180) / Math.PI;

  return (
    <g data-layer="wall-resize-preview" pointerEvents="none">
      {polygons &&
        preview?.map((resized) => {
          if (unchanged.has(resized)) return null;
          const polygon = polygons.get(resized.id);
          if (!polygon) return null;
          return (
            <polygon
              key={resized.id}
              data-wall-id={resized.id}
              points={polygonToPoints(polygon)}
              fill="var(--sp-accent)"
              fillOpacity={0.2}
              stroke="var(--sp-accent)"
              strokeWidth={2}
              strokeDasharray="5 4"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      {(["a", "b"] as const).map((end) => {
        if (edit.anchor === end) return null;
        const { x, y } = wall[end];
        const reversed = (end === "a") !== Boolean(shrinking);
        return (
          <path
            key={end}
            data-resize-end={end}
            d="M 10 -5 L 16 0 L 10 5"
            transform={`translate(${x} ${y}) rotate(${angle + (reversed ? 180 : 0)}) scale(${1 / scale})`}
            fill="none"
            stroke="var(--sp-accent)"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </g>
  );
}
