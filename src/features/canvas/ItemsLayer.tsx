import { isDoor } from "@app/schema";
import { useApp } from "@app/store";
import {
  getDoorArcPath,
  getDoorGeometry,
  getWindowGeometry,
} from "@geometry/itemGeometry";

export function ItemsLayer() {
  const plan = useApp((s) => s.plan);
  const wallsById = new Map(plan.walls.map((w) => [w.id, w]));

  return (
    <g data-layer="items">
      {plan.items.map((item) => {
        const wall = wallsById.get(item.wallAttach.wallId);
        if (!wall) return null;

        if (!isDoor(item)) {
          const { rect, midline } = getWindowGeometry(item, wall);
          return (
            <g key={item.id}>
              <rect
                x={rect.x}
                y={rect.y}
                width={rect.width}
                height={rect.height}
                transform={`rotate(${rect.angleDeg}, ${rect.cx}, ${rect.cy})`}
                fill="var(--sp-bg)"
                stroke="var(--sp-wall)"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={midline.x1}
                y1={midline.y1}
                x2={midline.x2}
                y2={midline.y2}
                transform={`rotate(${rect.angleDeg}, ${rect.cx}, ${rect.cy})`}
                stroke="var(--sp-wall)"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        }

        const geometry = getDoorGeometry(item, wall);
        const { rect, hinge, tipOpen } = geometry;

        return (
          <g key={item.id}>
            {/* Hollow opening rectangle aligned to the wall */}
            <rect
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              transform={`rotate(${rect.angleDeg}, ${rect.cx}, ${rect.cy})`}
              fill="var(--sp-bg)"
              stroke="var(--sp-wall)"
              vectorEffect="non-scaling-stroke"
            />
            {/* Door swing arc */}
            <path
              d={getDoorArcPath(geometry)}
              fill="none"
              stroke="var(--sp-wall)"
              vectorEffect="non-scaling-stroke"
            />
            {/* Door leaf line (from hinge to open tip) for clarity */}
            <line
              x1={hinge.x}
              y1={hinge.y}
              x2={tipOpen.x}
              y2={tipOpen.y}
              stroke="var(--sp-wall)"
              vectorEffect="non-scaling-stroke"
            />
            {/* Small hinge dot */}
            <circle
              cx={hinge.x}
              cy={hinge.y}
              r={3}
              fill="var(--sp-wall)"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}
    </g>
  );
}
