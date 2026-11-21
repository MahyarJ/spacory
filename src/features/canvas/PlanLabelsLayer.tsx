import type { PlanLabel, Point } from "@app/schema";
import {
  PLAN_LABEL_FONT_FAMILY,
  PLAN_LABEL_FONT_SIZE,
  PLAN_LABEL_STROKE_WIDTH,
  type planLabelRect,
} from "@geometry/planLabels";

export function PlanLabelsLayer({
  frames,
  selectedId,
  preview,
  pending,
  scale,
}: {
  frames: { label: PlanLabel; rect: ReturnType<typeof planLabelRect> }[];
  selectedId?: string;
  preview: { id: string; position: Point } | null;
  pending: Point | null;
  scale: number;
}) {
  return (
    <g data-layer="plan-labels" pointerEvents="none">
      {frames.map(({ label, rect }) => {
        const position =
          preview?.id === label.id ? preview.position : label.position;
        return (
          <g
            key={label.id}
            transform={`translate(${position.x} ${position.y})`}
          >
            {selectedId === label.id && (
              <rect
                x={rect.x - label.position.x}
                y={rect.y - label.position.y}
                width={rect.w}
                height={rect.h}
                fill="none"
                stroke="var(--sp-accent)"
                vectorEffect="non-scaling-stroke"
              />
            )}
            <text
              xmlSpace="preserve"
              textAnchor="middle"
              fontSize={PLAN_LABEL_FONT_SIZE}
              fontFamily={PLAN_LABEL_FONT_FAMILY}
              fill="var(--sp-text)"
              stroke="var(--sp-bg)"
              strokeWidth={PLAN_LABEL_STROKE_WIDTH}
              paintOrder="stroke"
            >
              {label.text}
            </text>
          </g>
        );
      })}
      {pending && (
        <circle
          cx={pending.x}
          cy={pending.y}
          r={4 / scale}
          fill="var(--sp-accent)"
        />
      )}
    </g>
  );
}
