import { useMemo } from "react";
import { useApp } from "@app/store";

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

    let minHalfH = Infinity; // from horizontal walls (height)
    let minHalfV = Infinity; // from vertical walls (width)
    let dirX: Direction = 0; // direction of the horizontal wall from the node
    let dirY: Direction = 0; // direction of the vertical wall from the node

    n.ends.forEach(({ i, end }) => {
      const w = walls[i];
      const dx = w.b.x - w.a.x;
      const dy = w.b.y - w.a.y;
      const L = Math.hypot(dx, dy) || 1;

      // tangent AWAY from node (IMPORTANT to avoid A/B ambiguity)
      const tx = end === "A" ? dx / L : -dx / L;
      const ty = end === "A" ? dy / L : -dy / L;
      const h = (w.thickness ?? 10) / 2;

      if (Math.abs(tx) >= Math.abs(ty)) {
        // horizontal wall -> contributes to cap HEIGHT (Y extent)
        minHalfH = Math.min(minHalfH, h);
        // choose the dominant X direction for the cap side
        if (Math.abs(tx) > Math.abs(dirX)) dirX = tx > 0 ? 1 : -1;
      } else {
        // vertical wall -> contributes to cap WIDTH (X extent)
        minHalfV = Math.min(minHalfV, h);
        // choose the dominant Y direction for the cap side
        if (Math.abs(ty) > Math.abs(dirY)) dirY = ty > 0 ? 1 : -1;
      }
    });

    // need at least one horizontal and one vertical contributor
    if (
      !isFinite(minHalfH) ||
      !isFinite(minHalfV) ||
      dirX === 0 ||
      dirY === 0
    ) {
      return;
    }

    // Apply inset (negative inset slightly expands to avoid hairlines)
    const capW = Math.max(0, minHalfV); // width along X
    const capH = Math.max(0, minHalfH); // height along Y

    // Decide which interior sides to extend toward:
    // (If your world is Y-UP, flip the checks for dirY)
    const extentLeft = dirX > 0 ? capW : 0;
    const extentRight = dirX < 0 ? capW : 0;
    const extentUp = dirY > 0 ? capH : 0;
    const extentDown = dirY < 0 ? capH : 0;

    const x = n.x - extentLeft;
    const y = n.y - extentUp;
    const wRect = extentLeft + extentRight;
    const hRect = extentUp + extentDown;

    caps.push(
      <rect
        key={key}
        x={x}
        y={y}
        width={wRect}
        height={hRect}
        fill="var(--sp-wall)"
      />
    );
  });

  return <g data-layer="node-caps-rect">{caps}</g>;
}
