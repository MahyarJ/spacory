import { useApp } from "@app/store";
import type { Point, Wall } from "@app/schema";

const wallPolygonPoints = (
  w: Wall
): {
  p1: Point;
  p2: Point;
  p3: Point;
  p4: Point;
} => {
  const dx = w.b.x - w.a.x;
  const dy = w.b.y - w.a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len; // unit normal
  const ny = dx / len;
  const h = w.thickness / 2;

  return {
    p1: { x: w.a.x + nx * h, y: w.a.y + ny * h },
    p2: { x: w.b.x + nx * h, y: w.b.y + ny * h },
    p3: { x: w.b.x - nx * h, y: w.b.y - ny * h },
    p4: { x: w.a.x - nx * h, y: w.a.y - ny * h },
  };
};

export function WallsLayer() {
  const walls = useApp((s) => s.plan.walls);
  return (
    <g data-layer="walls">
      {walls.map((w) => {
        const { p1, p2, p3, p4 } = wallPolygonPoints(w);
        return (
          <polygon
            key={w.id}
            points={`${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y} ${p4.x},${p4.y}`}
            fill="var(--sp-wall)"
            stroke="none"
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </g>
  );
}
