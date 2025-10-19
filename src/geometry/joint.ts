import { Point, Wall } from "@app/schema";

const sub = (p: Point, q: Point): Point => ({
  x: p.x - q.x,
  y: p.y - q.y,
});

const add = (p: Point, q: Point): Point => ({
  x: p.x + q.x,
  y: p.y + q.y,
});

const mul = (p: Point, k: number): Point => ({ x: p.x * k, y: p.y * k });

const len = (p: Point) => Math.hypot(p.x, p.y) || 1;

const unit = (p: Point): Point => {
  const L = len(p);
  return { x: p.x / L, y: p.y / L };
};

const right = (p: Point): Point => ({ x: p.y, y: -p.x });

const intersectRays = (
  P: Point,
  dP: Point,
  Q: Point,
  dQ: Point,
  eps = 1e-6
): Point | null => {
  const det = dP.x * dQ.y - dP.y * dQ.x;
  if (Math.abs(det) < eps) return null; // parallel
  const Rx = Q.x - P.x;
  const Ry = Q.y - P.y;
  const s = (Rx * dQ.y - Ry * dQ.x) / det;

  return { x: P.x + s * dP.x, y: P.y + s * dP.y };
};

/**
 * Compute the pivot at a junction of w1 and w2.
 * end1/end2 indicate which endpoint of each wall is the junction ('A' or 'B').
 * n is the shared node (intersection) coordinate.
 */
export const computeJunctionPivot = (
  w1: Wall,
  end1: "A" | "B",
  w2: Wall,
  end2: "A" | "B",
  n: Point
): Point | null => {
  // Wall 1: tangent pointing AWAY from the node, then its outward normal
  const centerlineDir1 = end1 === "A" ? sub(w1.b, w1.a) : sub(w1.a, w1.b); // A->B or B->A
  const tangentAwayFromNode1 = unit(centerlineDir1); // t₁
  const outwardNormal1 = right(tangentAwayFromNode1); // n₁ (right-hand)

  // Inner edge (toward room interior) starts at node, shifted by −h along the normal.
  const halfThickness1 = (w1.thickness ?? 10) / 2;
  const innerEdgeStart1 = add(n, mul(outwardNormal1, -halfThickness1)); // P₁_in

  // Wall 2: same computation
  const centerlineDir2 = end2 === "A" ? sub(w2.b, w2.a) : sub(w2.a, w2.b);
  const tangentAwayFromNode2 = unit(centerlineDir2); // t₂
  const outwardNormal2 = right(tangentAwayFromNode2); // n₂
  const halfThickness2 = (w2.thickness ?? 10) / 2;
  const innerEdgeStart2 = add(n, mul(outwardNormal2, halfThickness2)); // P₂_in

  // Pivot = intersection of the two edges, treated as rays
  // Rays go forward from the node along each wall’s tangent.
  const pivot = intersectRays(
    innerEdgeStart1,
    tangentAwayFromNode1,
    innerEdgeStart2,
    tangentAwayFromNode2
  );

  return pivot;
};
