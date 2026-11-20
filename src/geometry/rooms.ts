import type { Point, RoomName, Wall } from "@app/schema";
import { pointsEqual } from "./connectivity";

const EPS = 1e-6;

export interface Room {
  /** Closed boundary, including the first point again at the end. */
  polygon: Point[];
  /** Centreline area in square centimetres. */
  area: number;
  labelPoint: Point;
}

interface Vertex {
  point: Point;
  outgoing: number[];
}
interface Edge {
  from: number;
  to: number;
  twin: number;
  next: number;
}

/** Signed shoelace area, translated to avoid cancellation far from the origin. */
function signedArea(points: Point[]): number {
  const origin = points[0];
  let twice = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    twice +=
      (a.x - origin.x) * (b.y - origin.y) - (b.x - origin.x) * (a.y - origin.y);
  }
  return twice / 2;
}

/** Area centroid, using local coordinates for precision on translated plans. */
function centroid(polygon: Point[], area: number): Point {
  const origin = polygon[0];
  let x = 0;
  let y = 0;
  for (let i = 1; i < polygon.length; i++) {
    const a = {
      x: polygon[i - 1].x - origin.x,
      y: polygon[i - 1].y - origin.y,
    };
    const b = { x: polygon[i].x - origin.x, y: polygon[i].y - origin.y };
    const cross = a.x * b.y - b.x * a.y;
    x += (a.x + b.x) * cross;
    y += (a.y + b.y) * cross;
  }
  return { x: origin.x + x / (6 * area), y: origin.y + y / (6 * area) };
}

/** Boundary points are excluded: a label anchor must be strictly inside. */
function isInterior(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 1; i < polygon.length; i++) {
    const a = polygon[i - 1];
    const b = polygon[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const cross = (point.x - a.x) * dy - (point.y - a.y) * dx;
    if (
      Math.abs(cross) <= EPS * Math.hypot(dx, dy) &&
      point.x >= Math.min(a.x, b.x) - EPS &&
      point.x <= Math.max(a.x, b.x) + EPS &&
      point.y >= Math.min(a.y, b.y) - EPS &&
      point.y <= Math.max(a.y, b.y) + EPS
    )
      return false;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < a.x + ((point.y - a.y) * dx) / dy
    )
      inside = !inside;
  }
  return inside;
}

export function findRoomAt(rooms: Room[], point: Point): Room | undefined {
  let containingRoom: Room | undefined;
  for (const room of rooms) {
    if (
      (!containingRoom || room.area < containingRoom.area) &&
      isInterior(point, room.polygon)
    ) {
      containingRoom = room;
    }
  }
  return containingRoom;
}

/** The first name in document order wins when several anchors share a face. */
export function resolveRoomNames(
  rooms: Room[],
  names: RoomName[] = [],
): Map<Room, RoomName> {
  const resolved = new Map<Room, RoomName>();
  for (const name of names) {
    const room = findRoomAt(rooms, name.anchor);
    if (room && !resolved.has(room)) resolved.set(room, name);
  }
  return resolved;
}

/** Prefer the visual centre; concave faces may need a guaranteed interior fallback. */
function labelPoint(polygon: Point[], area: number): Point {
  const centre = centroid(polygon, area);
  return isInterior(centre, polygon) ? centre : interiorPoint(polygon);
}

/** Pick the midpoint of an interior horizontal interval; works for concave faces. */
function interiorPoint(polygon: Point[]): Point {
  const ys = [...new Set(polygon.map((p) => p.y))].sort((a, b) => a - b);
  // Use the widest vertical band, avoiding vertices and horizontal edges entirely.
  let y = 0;
  let height = -1;
  for (let i = 1; i < ys.length; i++) {
    if (ys[i] - ys[i - 1] > height) {
      height = ys[i] - ys[i - 1];
      y = ys[i - 1] + height / 2;
    }
  }
  const xs: number[] = [];
  for (let i = 1; i < polygon.length; i++) {
    const a = polygon[i - 1];
    const b = polygon[i];
    if (a.y > y !== b.y > y) {
      xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
  }
  xs.sort((a, b) => a - b);
  let x = xs[0];
  let width = -1;
  for (let i = 1; i < xs.length; i += 2) {
    if (xs[i] - xs[i - 1] > width) {
      width = xs[i] - xs[i - 1];
      x = xs[i - 1] + width / 2;
    }
  }
  return { x, y };
}

/**
 * Bounded faces of a planar wall-centreline graph. Connections must already be
 * split into shared endpoints (as the plan commit pipeline does for T junctions).
 * Openings are irrelevant. Holes and unsplit crossings are not modelled here.
 * Spatial buckets + sorted half-edges keep work O(E log E) for ordinary plans.
 */
export function detectRooms(walls: Wall[]): Room[] {
  const vertices: Vertex[] = [];
  const buckets = new Map<string, number[]>();
  const vertexAt = (point: Point): number => {
    const x = Math.floor(point.x / EPS);
    const y = Math.floor(point.y / EPS);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const id of buckets.get(`${x + dx},${y + dy}`) ?? []) {
          if (pointsEqual(vertices[id].point, point)) return id;
        }
      }
    }
    const id = vertices.length;
    vertices.push({ point: { ...point }, outgoing: [] });
    const key = `${x},${y}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(id);
    buckets.set(key, bucket);
    return id;
  };
  const edges: Edge[] = [];
  const pairs = new Set<string>();
  for (const wall of walls) {
    if (![wall.a.x, wall.a.y, wall.b.x, wall.b.y].every(Number.isFinite))
      continue;
    const a = vertexAt(wall.a);
    const b = vertexAt(wall.b);
    if (a === b) continue;
    const key = `${Math.min(a, b)},${Math.max(a, b)}`;
    if (pairs.has(key)) continue;
    pairs.add(key);
    const id = edges.length;
    edges.push(
      { from: a, to: b, twin: id + 1, next: -1 },
      { from: b, to: a, twin: id, next: -1 },
    );
    vertices[a].outgoing.push(id);
    vertices[b].outgoing.push(id + 1);
  }
  for (const vertex of vertices) {
    const angle = (id: number) => {
      const p = vertices[edges[id].to].point;
      return Math.atan2(p.y - vertex.point.y, p.x - vertex.point.x);
    };
    vertex.outgoing.sort((a, b) => angle(a) - angle(b));
    // Turn clockwise from the incoming twin, keeping the bounded face on the left.
    for (let i = 0; i < vertex.outgoing.length; i++) {
      edges[edges[vertex.outgoing[i]].twin].next =
        vertex.outgoing[
          (i + vertex.outgoing.length - 1) % vertex.outgoing.length
        ];
    }
  }
  const rooms: Room[] = [];
  const visited = new Set<number>();
  for (let start = 0; start < edges.length; start++) {
    if (visited.has(start)) continue;
    const walk: number[] = [];
    let edge = start;
    while (!visited.has(edge)) {
      visited.add(edge);
      walk.push(edges[edge].from);
      edge = edges[edge].next;
    }
    if (edge !== start) continue;
    // Split repeated-vertex walks into simple cycles. This drops dangling spurs
    // (two-edge zero-area loops) without losing rooms at articulation points.
    const path: number[] = [];
    const positions = new Map<number, number>();
    for (const id of [...walk, walk[0]]) {
      const position = positions.get(id);
      if (position === undefined) {
        positions.set(id, path.length);
        path.push(id);
        continue;
      }
      const polygon = [...path.slice(position), id].map(
        (v) => vertices[v].point,
      );
      const area = signedArea(polygon);
      if (area > EPS)
        rooms.push({ polygon, area, labelPoint: labelPoint(polygon, area) });
      while (path.length > position + 1) positions.delete(path.pop()!);
    }
  }
  return rooms;
}
