import {
  WALL_DIMENSION_FONT_SIZE,
  type WallDimension,
} from "@geometry/wallDimensions";

export function DimensionsLayer({
  dimensions,
  scale,
}: {
  dimensions: WallDimension[];
  scale: number;
}) {
  return (
    <g data-layer="dimensions" style={{ pointerEvents: "none" }}>
      {dimensions.map(({ id, midpoint, angle, offset, text }) => (
        <g
          key={id}
          transform={`translate(${midpoint.x} ${midpoint.y}) rotate(${angle}) scale(${1 / scale})`}
        >
          <text
            x={0}
            y={-offset}
            textAnchor="middle"
            fontSize={WALL_DIMENSION_FONT_SIZE}
            fontFamily="var(--sp-font)"
            fill="var(--sp-text)"
            stroke="var(--sp-bg)"
            strokeWidth={3}
            paintOrder="stroke"
          >
            {text}
          </text>
        </g>
      ))}
    </g>
  );
}
