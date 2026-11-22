import type { Point } from "@app/schema";
import { useApp } from "@app/store";
import type { ViewState } from "@app/viewport";
import {
  type MeasurePlanLabel,
  PLAN_LABEL_FONT_FAMILY,
  PLAN_LABEL_FONT_SIZE,
} from "@geometry/planLabels";
import { ROOM_LABEL_FONT_WEIGHT } from "@geometry/roomLabels";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import styles from "./FloorPlan.module.css";
import { PlanLabelText } from "./PlanLabelsLayer";

export function InlineLabelEditor({
  position,
  text = "",
  view,
  measure,
  previewLayer,
}: {
  position: Point;
  text?: string;
  view: ViewState;
  measure?: MeasurePlanLabel;
  previewLayer: SVGGElement | null;
}) {
  const finishLabelEdit = useApp((state) => state.finishLabelEdit);
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const [draft, setDraft] = useState(text);
  const finish = useCallback(
    (value?: string) => {
      if (finished.current) return;
      finished.current = true;
      finishLabelEdit(value);
    },
    [finishLabelEdit],
  );

  useLayoutEffect(() => {
    const field = input.current;
    if (!field) return;
    field.focus({ preventScroll: true });
    field.setSelectionRange(field.value.length, field.value.length);

    // A canvas press can replace the selection before a removed input blurs.
    // Finish first so the gesture sees the committed label and its new bounds.
    const onPointerDown = (event: PointerEvent) => {
      if (event.target !== field) flushSync(() => finish(field.value));
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [finish]);

  const fontSize = PLAN_LABEL_FONT_SIZE * view.scale;
  const metrics = measure?.(draft);
  const factor = view.scale;
  const ascent =
    (metrics?.fontBoundingBoxAscent ?? PLAN_LABEL_FONT_SIZE * 0.8) * factor;
  const descent =
    (metrics?.fontBoundingBoxDescent ?? PLAN_LABEL_FONT_SIZE * 0.2) * factor;
  const height = fontSize * 1.25;
  const width = Math.max(
    fontSize,
    (metrics?.width ?? draft.length * PLAN_LABEL_FONT_SIZE * 0.7) * factor + 8,
  );

  return (
    <>
      {previewLayer &&
        createPortal(
          <g transform={`translate(${position.x} ${position.y})`}>
            <PlanLabelText text={draft} />
          </g>,
          previewLayer,
        )}
      <input
        ref={input}
        aria-label="Label text"
        type="text"
        enterKeyHint="done"
        spellCheck={false}
        className={styles.inlineLabel}
        style={{
          left: position.x * view.scale + view.panX,
          top:
            position.y * view.scale +
            view.panY -
            (height + ascent - descent) / 2,
          width,
          height,
          fontFamily: PLAN_LABEL_FONT_FAMILY,
          fontSize,
          fontWeight: ROOM_LABEL_FONT_WEIGHT,
          lineHeight: `${height}px`,
        }}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => finish(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter" || event.key === "Escape") {
            event.preventDefault();
            finish(
              event.key === "Enter" ? event.currentTarget.value : undefined,
            );
          }
        }}
      />
    </>
  );
}
