import type { Fixture, Point } from "@app/schema";
import type { Bounds } from "./bounds";

export const FIXTURE_STROKE_WIDTH = 1.5;

export function getFixtureFrame({ width, depth }: Fixture) {
  return { x: -width / 2, y: -depth / 2, width, height: depth };
}

export function fixtureTransform({ position, rotation }: Fixture): string {
  return `translate(${position.x} ${position.y}) rotate(${rotation % 360})`;
}

export function getFixtureBounds(fixture: Fixture): Bounds {
  const { width, depth, position, rotation } = fixture;
  const angle = ((rotation % 360) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const halfWidth = (width / 2) * cos + (depth / 2) * sin;
  const halfDepth = (width / 2) * sin + (depth / 2) * cos;
  const pad = FIXTURE_STROKE_WIDTH / 2;
  return {
    minX: position.x - halfWidth - pad,
    minY: position.y - halfDepth - pad,
    maxX: position.x + halfWidth + pad,
    maxY: position.y + halfDepth + pad,
  };
}

export function hitFixture(
  point: Point,
  fixture: Fixture,
  pad: number,
): boolean {
  const { position, width, depth, rotation } = fixture;
  const angle = ((rotation % 360) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - position.x;
  const dy = point.y - position.y;
  return (
    Math.abs(dx * cos + dy * sin) <= width / 2 + pad &&
    Math.abs(-dx * sin + dy * cos) <= depth / 2 + pad
  );
}

export function getFixtureSymbol(fixture: Fixture) {
  const rim = getFixtureFrame(fixture);
  const { width, depth } = fixture;
  const basin = {
    x: -width * 0.4,
    y: -depth * 0.22,
    width: width * 0.8,
    height: depth * 0.62,
    rx: Math.min(width, depth) * 0.13,
  };
  const drain = { cx: 0, cy: depth * 0.12, r: Math.min(width, depth) * 0.045 };
  const tap = `M 0 ${-depth * 0.4} V ${-depth * 0.13}`;
  return { rim, basin, drain, tap };
}
