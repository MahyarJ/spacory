import { DEFAULT_PLAN_LABEL_TEXT } from "@app/planLabel";
import type { PlanLabel, Point } from "@app/schema";
import {
  MIN_PLAN_LABEL_SCREEN_SIZE,
  PLAN_LABEL_FONT_FAMILY,
  PLAN_LABEL_FONT_SIZE,
  PLAN_LABEL_STROKE_WIDTH,
  planLabelCanvasScale,
  type planLabelRect,
} from "@geometry/planLabels";

function PlanLabelText({
  text,
  fontScale,
  position,
}: {
  text: string;
  fontScale: number;
  position?: Point;
}) {
  return (
    <text
      x={position?.x}
      y={position?.y}
      xmlSpace="preserve"
      textAnchor="middle"
      fontSize={PLAN_LABEL_FONT_SIZE * fontScale}
      fontFamily={PLAN_LABEL_FONT_FAMILY}
      fill={position ? "var(--sp-accent)" : "var(--sp-text)"}
      stroke="var(--sp-bg)"
      strokeWidth={PLAN_LABEL_STROKE_WIDTH * fontScale}
      paintOrder="stroke"
    >
      {text}
    </text>
  );
}

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
  pending: { position: Point; text: string } | null;
  scale: number;
}) {
  const fontScale = planLabelCanvasScale(scale);
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
            <PlanLabelText text={label.text} fontScale={fontScale} />
          </g>
        );
      })}
      {pending && (
        <PlanLabelText
          position={pending.position}
          text={pending.text.trim() ? pending.text : DEFAULT_PLAN_LABEL_TEXT}
          fontScale={Math.max(
            fontScale,
            MIN_PLAN_LABEL_SCREEN_SIZE / (PLAN_LABEL_FONT_SIZE * scale),
          )}
        />
      )}
    </g>
  );
}
