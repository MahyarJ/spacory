import { useApp } from "@app/store";
import type { Wall } from "@app/schema";

function wallPolygonPoints(w: Wall) {
  const dx = w.b.x - w.a.x;
  const dy = w.b.y - w.a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len; // unit normal
  const ny = dx / len;
  const h = w.thickness / 2;

  const p1 = { x: w.a.x + nx * h, y: w.a.y + ny * h };
  const p2 = { x: w.b.x + nx * h, y: w.b.y + ny * h };
  const p3 = { x: w.b.x - nx * h, y: w.b.y - ny * h };
  const p4 = { x: w.a.x - nx * h, y: w.a.y - ny * h };
  return `${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y} ${p4.x},${p4.y}`;
}

export function WallsLayer() {
  const walls = useApp((s) => s.plan.walls);
  return (
    <g data-layer="walls">
      {walls.map((w) => (
        <polygon
          key={w.id}
          points={wallPolygonPoints(w)}
          fill="var(--sp-wall)"
          stroke="none"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
}
