import { formatLength } from "@app/format";
import { useApp } from "@app/store";
import { getPointOnWall, getWallAngle, getWallLength } from "@geometry/wall";

/** On-screen font size (px) for length labels — constant regardless of zoom. */
const FONT_PX = 12;
/** Perpendicular offset (px) lifting the label just off the wall centreline. */
const LABEL_OFFSET_PX = 8;
/**
 * Walls shorter than this on screen (px) get no label: there isn't room for it
 * to read cleanly, so we hide it rather than let it overflow the wall.
 */
const MIN_ON_SCREEN_PX = 24;

/**
 * Visual-only layer drawing each wall's length near its midpoint.
 *
 * Legibility approach: the label is **counter-scaled** by `1/view.scale`. The
 * enclosing canvas `<g>` scales everything by `view.scale`, so a `scale(1/s)`
 * here makes one inner unit equal one screen pixel — `FONT_PX` and
 * `LABEL_OFFSET_PX` stay constant on screen at any zoom.
 *
 * The layer reads `plan.walls` from the store, so it re-renders live as walls
 * are drawn, moved (including mid-drag), and deleted. It is non-interactive
 * (`pointer-events: none`) so it never interferes with hit-testing.
 */
export function DimensionsLayer() {
  const walls = useApp((s) => s.plan.walls);
  const units = useApp((s) => s.plan.meta.units);
  const scale = useApp((s) => s.view.scale);

  return (
    <g data-layer="dimensions" style={{ pointerEvents: "none" }}>
      {walls.map((w) => {
        const len = getWallLength(w);
        // Short-wall rule: skip if the wall is too small on screen for a label.
        if (len * scale < MIN_ON_SCREEN_PX) return null;

        const mid = getPointOnWall(w, len / 2);
        let angleDeg = (getWallAngle(w) * 180) / Math.PI;
        // Keep text upright: flip walls that would render it upside-down. The
        // label lands on the wall's other side, which stays readable.
        if (angleDeg > 90 || angleDeg < -90) angleDeg += 180;

        return (
          <g
            key={w.id}
            transform={`translate(${mid.x} ${mid.y}) rotate(${angleDeg}) scale(${1 / scale})`}
          >
            <text
              x={0}
              y={-LABEL_OFFSET_PX}
              textAnchor="middle"
              fontSize={FONT_PX}
              fontFamily="var(--sp-font)"
              fill="var(--sp-text)"
              stroke="var(--sp-bg)"
              strokeWidth={3}
              paintOrder="stroke"
            >
              {formatLength(len, units)}
            </text>
          </g>
        );
      })}
    </g>
  );
}
