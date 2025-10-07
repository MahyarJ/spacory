import { useApp } from "@app/store";
import { getPointOnWall, getWallAngle, getWallDirection } from "@geometry/wall";

export function ItemsLayer() {
  const plan = useApp((s) => s.plan);
  const wallsById = new Map(plan.walls.map((w) => [w.id, w]));

  return (
    <g data-layer="items">
      {plan.items.map((item) => {
        const wall = wallsById.get(item.wallAttach.wallId);
        if (!wall) return null;

        const angle = getWallAngle(wall);
        const dir = getWallDirection(wall); // unit vector along wall
        const n = { x: -dir.y, y: dir.x }; // unit normal (perpendicular to wall)

        const offsetA = item.wallAttach.offset;
        const length = item.wallAttach.length;
        const thickness = wall.thickness;

        // Opening center (midpoint along wall)
        const centerOffset = offsetA + length / 2;
        const c = getPointOnWall(wall, centerOffset);

        // Rectangle: draw centered at (c), rotated with wall
        const rectX = c.x - length / 2;
        const rectY = c.y - thickness / 2;

        if (item.type === "window") {
          return (
            <g key={item.id}>
              <rect
                x={rectX}
                y={rectY}
                width={length}
                height={thickness}
                transform={`rotate(${(angle * 180) / Math.PI}, ${c.x}, ${c.y})`}
                fill="var(--sp-bg)"
                stroke="var(--sp-wall)"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={c.x - length / 2}
                y1={c.y}
                x2={c.x + length / 2}
                y2={c.y}
                transform={`rotate(${(angle * 180) / Math.PI}, ${c.x}, ${c.y})`}
                stroke="var(--sp-wall)"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        }

        // Default -> door
        // Hinge at the "end" edge midpoint (to switch hinge sides, swap dir sign)
        const hinge = {
          x: c.x + dir.x * (length / 2),
          y: c.y + dir.y * (length / 2),
        };

        // Closed leaf tip (along wall direction) (to switch hinge sides, swap dir sign also here)
        const tipClosed = {
          x: hinge.x - dir.x * length,
          y: hinge.y - dir.y * length,
        };

        const side = -1; // +1 = +normal(inside), -1 = -normal(outside)
        const tipOpen = {
          x: hinge.x + side * n.x * length,
          y: hinge.y + side * n.y * length,
        };

        // sweepFlag depends on direction: use 1 for +n, 0 for -n (empirically correct in SVG's Y-down coords).
        const sweepFlag = side > 0 ? 0 : 1;
        // SVG arc from closed tip to open tip around the hinge, 90° sweep
        // We want a 90° (small) arc, so largeArcFlag = 0.
        const arcPath = `M ${tipClosed.x} ${tipClosed.y} A ${length} ${length} 0 0 ${sweepFlag} ${tipOpen.x} ${tipOpen.y}`;

        return (
          <g key={item.id}>
            {/* Hollow opening rectangle aligned to the wall */}
            <rect
              x={rectX}
              y={rectY}
              width={length}
              height={thickness}
              transform={`rotate(${(angle * 180) / Math.PI}, ${c.x}, ${c.y})`}
              fill="var(--sp-bg)"
              stroke="var(--sp-wall)"
              vectorEffect="non-scaling-stroke"
            />
            {/* Door swing arc */}
            <path
              d={arcPath}
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
