import { useApp } from "@app/store";

export function WallsLayer() {
  const walls = useApp((s) => s.plan.walls);
  return (
    <g data-layer="walls" stroke="var(--sp-wall)" strokeWidth={2}>
      {walls.map((w) => (
        <line key={w.id} x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} />
      ))}
    </g>
  );
}
