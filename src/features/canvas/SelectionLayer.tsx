import { useApp } from "@app/store";

function wallPolygonPoints(
  a: { x: number; y: number },
  b: { x: number; y: number },
  thickness: number
) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len,
    ny = dx / len;
  const h = thickness / 2;
  const p1 = { x: a.x + nx * h, y: a.y + ny * h };
  const p2 = { x: b.x + nx * h, y: b.y + ny * h };
  const p3 = { x: b.x - nx * h, y: b.y - ny * h };
  const p4 = { x: a.x - nx * h, y: a.y - ny * h };
  return `${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y} ${p4.x},${p4.y}`;
}

export function SelectionLayer() {
  const plan = useApp((s) => s.plan);
  const selW = useApp((s) => s.selectedWalls);
  const selI = useApp((s) => s.selectedItems);

  return (
    <g data-layer="selection">
      {plan.walls.map(
        // Selected walls highlight
        (w) =>
          selW.has(w.id) && (
            <polygon
              key={"sw-" + w.id}
              points={wallPolygonPoints(w.a, w.b, w.thickness)}
              fill="none"
              stroke="var(--sp-accent)"
              strokeWidth={4}
              vectorEffect="non-scaling-stroke"
            />
          )
      )}
      {plan.items.map((i) => {
        // Selected items highlight
        if (!selI.has(i.id)) return null;
        const wall = plan.walls.find((w) => w.id === i.wallAttach.wallId);
        if (!wall) return null;
        const angle = Math.atan2(wall.b.y - wall.a.y, wall.b.x - wall.a.x);
        const mid = i.wallAttach.offset + i.wallAttach.length / 2;
        const cx =
          wall.a.x +
          (wall.b.x - wall.a.x) *
            (mid / Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y));
        const cy =
          wall.a.y +
          (wall.b.y - wall.a.y) *
            (mid / Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y));
        return (
          <rect
            key={"si-" + i.id}
            x={cx - i.wallAttach.length / 2}
            y={cy - i.thickness / 2}
            width={i.wallAttach.length}
            height={i.thickness}
            transform={`rotate(${(angle * 180) / Math.PI}, ${cx}, ${cy})`}
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
