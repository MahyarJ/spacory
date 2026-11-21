import type { Point, RoomName, Wall } from "@app/schema";
import { pointsEqual } from "./connectivity";

const EPS = 1e-6;

export interface Room {
  /** Closed boundary, including the first point again at the end. */
  polygon: Point[];
  /** Enclosed faces whose interiors belong to their own room. */
  nested: Point[][];
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
function isInterior(
  point: Point,
  polygon: Point[],
  includeBoundary = false,
): boolean {
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
      return includeBoundary;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < a.x + ((point.y - a.y) * dx) / dy
    )
      inside = !inside;
  }
  return inside;
}

function ownsPoint(room: Room, point: Point): boolean {
  return (
    isInterior(point, room.polygon) &&
    !room.nested.some((nested) => isInterior(point, nested, true))
  );
}

export function findRoomAt(rooms: Room[], point: Point): Room | undefined {
  let containingRoom: Room | undefined;
  for (const room of rooms) {
    if (
      (!containingRoom || room.area < containingRoom.area) &&
      ownsPoint(room, point)
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

/** Give surrounding rooms a point outside any enclosure they contain. */
function assignNestedRooms(rooms: Room[]) {
  const ordered = rooms
    .map((room) => ({
      room,
      // A contained face has to fit within the candidate's bounding rectangle.
      left: Math.min(...room.polygon.map((p) => p.x)),
      right: Math.max(...room.polygon.map((p) => p.x)),
      top: Math.min(...room.polygon.map((p) => p.y)),
      bottom: Math.max(...room.polygon.map((p) => p.y)),
    }))
    .sort((a, b) => a.room.area - b.room.area);
  for (let i = 0; i < ordered.length; i++) {
    const child = ordered[i];
    for (let j = i + 1; j < ordered.length; j++) {
      const parent = ordered[j];
      if (
        parent.room.area > child.room.area &&
        child.left >= parent.left &&
        child.right <= parent.right &&
        child.top >= parent.top &&
        child.bottom <= parent.bottom &&
        isInterior(child.room.labelPoint, parent.room.polygon)
      ) {
        parent.room.nested.push(child.room.polygon);
        break;
      }
    }
  }
  for (const { room } of ordered) {
    if (room.nested.length === 0 || ownsPoint(room, room.labelPoint)) continue;
    const polygons = [room.polygon, ...room.nested];
    const ys = [
      ...new Set(
        polygons.flatMap((polygon) => polygon.map((point) => point.y)),
      ),
    ].sort((a, b) => a - b);
    let best = 0;
    for (let row = 1; row < ys.length; row++) {
      const height = ys[row] - ys[row - 1];
      const y = ys[row - 1] + height / 2;
      const xs: number[] = [];
      for (const polygon of polygons) {
        for (let i = 1; i < polygon.length; i++) {
          const a = polygon[i - 1];
          const b = polygon[i];
          if (a.y > y !== b.y > y)
            xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
        }
      }
      xs.sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) {
        const width = xs[i] - xs[i - 1];
        const point = { x: xs[i - 1] + width / 2, y };
        if (width * height > best && ownsPoint(room, point)) {
          best = width * height;
          room.labelPoint = point;
        }
      }
    }
  }
}

/**
 * Bounded faces of a planar wall-centreline graph. Connections must already be
 * split into shared endpoints (as the plan commit pipeline does for T junctions).
 * Openings are irrelevant. Unsplit crossings are outside this graph model.
 * Nested outlines partition ownership and label placement while each room's
 * area remains the measurement of its own centreline polygon.
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
        rooms.push({
          polygon,
          area,
          labelPoint: labelPoint(polygon, area),
          nested: [],
        });
      while (path.length > position + 1) positions.delete(path.pop()!);
    }
  }
  assignNestedRooms(rooms);
  return rooms;
}
