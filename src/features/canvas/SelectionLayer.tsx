import { useApp } from "@app/store";
import { computeWallGeometry, polygonToPoints } from "@geometry/junction";
import { getPointOnWall, getWallAngle } from "@geometry/wall";
import { useMemo } from "react";

export function SelectionLayer() {
  const plan = useApp((s) => s.plan);
  const selW = useApp((s) => s.selectedWalls);
  const selI = useApp((s) => s.selectedItems);
  const { walls: polygons } = useMemo(
    () => computeWallGeometry(plan.walls),
    [plan.walls],
  );

  return (
    <g data-layer="selection">
      {plan.walls.map((w) => {
        // Selected walls highlight, using the same mitered outline as the fill.
        if (!selW.has(w.id)) return null;
        const quad = polygons.get(w.id);
        if (!quad) return null;
        return (
          <polygon
            key={`sw-${w.id}`}
            points={polygonToPoints(quad)}
            fill="none"
            stroke="var(--sp-accent)"
            strokeWidth={4}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      {plan.items.map((i) => {
        // Selected items highlight
        if (!selI.has(i.id)) return null;
        const wall = plan.walls.find((w) => w.id === i.wallAttach.wallId);
        if (!wall) return null;
        const angle = getWallAngle(wall);
        const mid = i.wallAttach.offset + i.wallAttach.length / 2;
        const c = getPointOnWall(wall, mid);
        return (
          <rect
            key={`si-${i.id}`}
            x={c.x - i.wallAttach.length / 2}
            y={c.y - i.thickness / 2}
            width={i.wallAttach.length}
            height={i.thickness}
            transform={`rotate(${(angle * 180) / Math.PI}, ${c.x}, ${c.y})`}
            fill="none"
            stroke="var(--sp-accent)"
            strokeWidth={4}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </g>
  );
}
