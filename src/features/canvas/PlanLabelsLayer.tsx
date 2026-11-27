import type { PlanLabel } from "@app/schema";
import type { LabelMove } from "@app/selection";
import {
  PLAN_LABEL_FONT_FAMILY,
  PLAN_LABEL_FONT_SIZE,
  PLAN_LABEL_STROKE_WIDTH,
  type planLabelRect,
} from "@geometry/planLabels";
import { ROOM_LABEL_FONT_WEIGHT } from "@geometry/roomLabels";
import type { Ref } from "react";

export function PlanLabelText({
  text,
  textRef,
}: {
  text: string;
  textRef?: Ref<SVGTextElement>;
}) {
  return (
    <text
      ref={textRef}
      xmlSpace="preserve"
      textAnchor="start"
      fontSize={PLAN_LABEL_FONT_SIZE}
      fontFamily={PLAN_LABEL_FONT_FAMILY}
      fontWeight={ROOM_LABEL_FONT_WEIGHT}
      fill="var(--sp-text)"
      stroke="var(--sp-bg)"
      strokeWidth={PLAN_LABEL_STROKE_WIDTH}
      paintOrder="stroke"
    >
      {text}
    </text>
  );
}

export function PlanLabelsLayer({
  frames,
  selectedIds,
  editingId,
  preview,
}: {
  frames: { label: PlanLabel; rect: ReturnType<typeof planLabelRect> }[];
  selectedIds: ReadonlySet<string>;
  editingId?: string;
  preview?: LabelMove & { blocked: boolean };
}) {
  return (
    <g data-layer="plan-labels" pointerEvents="none">
      {frames.map(({ label, rect }) => {
        if (label.id === editingId) return null;
        const selected = selectedIds.has(label.id);
        const drag = preview?.ids.has(label.id) ? preview : undefined;
        const { x, y } = drag?.movePoint(label.position) ?? label.position;
        return (
          <g
            key={label.id}
            transform={`translate(${x} ${y})`}
            data-label-preview={
              drag ? (drag.blocked ? "blocked" : "valid") : undefined
            }
          >
            {selected && (
              <rect
                x={rect.x - label.position.x}
                y={rect.y - label.position.y}
                width={rect.w}
                height={rect.h}
                fill="none"
                stroke={
                  drag?.blocked
                    ? "var(--sp-preview-blocked)"
                    : "var(--sp-accent)"
                }
                vectorEffect="non-scaling-stroke"
              />
            )}
            <PlanLabelText text={label.text} />
          </g>
        );
      })}
    </g>
  );
}
