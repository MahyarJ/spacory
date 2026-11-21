import type { Point } from "@app/schema";
import { useApp } from "@app/store";
import type { ViewState } from "@app/viewport";
import {
  type MeasurePlanLabel,
  MIN_PLAN_LABEL_SCREEN_SIZE,
  PLAN_LABEL_FONT_FAMILY,
  PLAN_LABEL_FONT_SIZE,
  planLabelCanvasScale,
} from "@geometry/planLabels";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import styles from "./FloorPlan.module.css";

export function InlineLabelEditor({
  position,
  text = "",
  view,
  measure,
}: {
  position: Point;
  text?: string;
  view: ViewState;
  measure?: MeasurePlanLabel;
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
    field.focus();
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

  const fontSize = Math.max(
    MIN_PLAN_LABEL_SCREEN_SIZE,
    PLAN_LABEL_FONT_SIZE * planLabelCanvasScale(view.scale) * view.scale,
  );
  const metrics = measure?.(draft);
  const factor = fontSize / PLAN_LABEL_FONT_SIZE;
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
    <input
      ref={input}
      aria-label="Label text"
      type="text"
      enterKeyHint="done"
      className={styles.inlineLabel}
      style={{
        left: position.x * view.scale + view.panX,
        top:
          position.y * view.scale + view.panY - (height + ascent - descent) / 2,
        width,
        height,
        fontFamily: PLAN_LABEL_FONT_FAMILY,
        fontSize,
        lineHeight: `${height}px`,
      }}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => finish(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter" || event.key === "Escape") {
          event.preventDefault();
          finish(event.key === "Enter" ? event.currentTarget.value : undefined);
        }
      }}
    />
  );
}
