import { useMemo } from "react";
import { useApp } from "@app/store";
import { computeJunctionPivot } from "@geometry/joint";

type Direction = -1 | 0 | 1;
type Key = string;
const keyOf = (x: number, y: number, tol = 1e-3): Key =>
  `${Math.round(x / tol)}:${Math.round(y / tol)}`;

// Draw rectangles to cover gaps at wall nodes (endpoints) where two+ walls meet
export function NodeCapsLayer() {
  const plan = useApp((s) => s.plan);
  const walls = plan.walls;
  const grid = plan.meta?.gridSize ?? 25;
  const TOL = Math.max(0.5, grid / 500);

  // 1) group endpoint nodes
  const nodes = useMemo(() => {
    const map = new Map<
      Key,
      { x: number; y: number; ends: Array<{ i: number; end: "A" | "B" }> }
    >();
    walls.forEach((w, i) => {
      const kA = keyOf(w.a.x, w.a.y, TOL);
      const kB = keyOf(w.b.x, w.b.y, TOL);
      const gA = map.get(kA) ?? { x: w.a.x, y: w.a.y, ends: [] };
      const gB = map.get(kB) ?? { x: w.b.x, y: w.b.y, ends: [] };
      gA.ends.push({ i, end: "A" });
      gB.ends.push({ i, end: "B" });
      map.set(kA, gA);
      map.set(kB, gB);
    });
    return map;
  }, [walls, TOL]);

  const caps: JSX.Element[] = [];
  nodes.forEach((n, key) => {
    if (n.ends.length < 2) return;

    const w1 = walls[n.ends[0].i];
    const w2 = walls[n.ends[1].i];

    const end1 = n.ends[0].end;
    const end2 = n.ends[1].end;

    const pivot1 = computeJunctionPivot(w1, end1, w2, end2, n);
    const pivot2 = computeJunctionPivot(w1, end2, w2, end1, n);
    const pivot3 = computeJunctionPivot(w1, end1, w2, end1, n);
    const pivot4 = computeJunctionPivot(w1, end2, w2, end2, n);

    caps.push(
      <polygon
        key={key}
        points={`${pivot1?.x},${pivot1?.y} ${pivot3?.x},${pivot3?.y} ${pivot2?.x},${pivot2?.y} ${pivot4?.x},${pivot4?.y}`}
        fill="var(--sp-wall)"
        vectorEffect="non-scaling-stroke"
      />
    );
  });

  return <g data-layer="node-caps-rect">{caps}</g>;
}
