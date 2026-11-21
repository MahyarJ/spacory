import type { PlanLabel, Point } from "@app/schema";
import {
  PLAN_LABEL_FONT_FAMILY,
  PLAN_LABEL_FONT_SIZE,
  PLAN_LABEL_STROKE_WIDTH,
  planLabelCanvasScale,
  type planLabelRect,
} from "@geometry/planLabels";

export function PlanLabelsLayer({
  frames,
  selectedId,
  preview,
  editingId,
  scale,
}: {
  frames: { label: PlanLabel; rect: ReturnType<typeof planLabelRect> }[];
  selectedId?: string;
  preview: { id: string; position: Point } | null;
  editingId?: string;
  scale: number;
}) {
  const fontScale = planLabelCanvasScale(scale);
  return (
    <g data-layer="plan-labels" pointerEvents="none">
      {frames.map(({ label, rect }) => {
        if (label.id === editingId) return null;
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
              fontSize={PLAN_LABEL_FONT_SIZE * fontScale}
              fontFamily={PLAN_LABEL_FONT_FAMILY}
              fill="var(--sp-text)"
              stroke="var(--sp-bg)"
              strokeWidth={PLAN_LABEL_STROKE_WIDTH * fontScale}
              paintOrder="stroke"
            >
              {label.text}
            </text>
          </g>
        );
      })}
    </g>
  );
}
