import type { Point } from "@app/schema";
import { useApp } from "@app/store";
import { revealLabelDraft, type ViewState } from "@app/viewport";
import {
  type MeasurePlanLabel,
  PLAN_LABEL_FONT_FAMILY,
  PLAN_LABEL_FONT_SIZE,
  planLabelAdvance,
  planLabelRect,
} from "@geometry/planLabels";
import { ROOM_LABEL_FONT_WEIGHT } from "@geometry/roomLabels";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import styles from "./FloorPlan.module.css";
import { PlanLabelText } from "./PlanLabelsLayer";

function caretSelection(field: HTMLInputElement) {
  const index =
    field.selectionDirection === "backward"
      ? field.selectionStart
      : field.selectionEnd;
  return {
    index: index ?? field.value.length,
    collapsed: field.selectionStart === field.selectionEnd,
  };
}

function renderedCaretOffset(text: SVGTextElement | null, index: number) {
  if (typeof text?.getNumberOfChars !== "function") return;
  const count = text.getNumberOfChars();
  if (!count) return 0;
  // SVG text geometry and native input selections both index UTF-16 units.
  try {
    const point =
      index === 0
        ? text.getStartPositionOfChar(0)
        : text.getEndPositionOfChar(Math.min(index, count) - 1);
    return Number.isFinite(point.x) ? point.x : undefined;
  } catch {
    // A text index may lack a glyph, such as during composition.
    return undefined;
  }
}

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
  const canvasSize = useApp((state) => state.canvasSize);
  const setView = useApp((state) => state.setView);
  const input = useRef<HTMLInputElement>(null);
  const draftText = useRef<SVGTextElement>(null);
  const finished = useRef(false);
  const [draft, setDraft] = useState(text);
  const [selection, setSelection] = useState({
    index: text.length,
    collapsed: true,
  });
  const [caretOffset, setCaretOffset] = useState(0);
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

  useLayoutEffect(() => {
    const rect = planLabelRect({ position, text: draft }, measure);
    const prefix = draft.slice(0, selection.index).replaceAll("\t", " ");
    const offset =
      renderedCaretOffset(draftText.current, selection.index) ??
      planLabelAdvance(prefix, measure?.(prefix));
    setCaretOffset(offset);
    const caretX = position.x + offset;
    const next = revealLabelDraft(
      view,
      canvasSize,
      {
        minX: Math.min(rect.x, caretX),
        minY: rect.y,
        maxX: Math.max(rect.x + rect.w, caretX),
        maxY: rect.y + rect.h,
      },
      { x: caretX, y: position.y },
    );
    if (next !== view) setView(() => next);
  }, [canvasSize, draft, measure, position, selection.index, setView, view]);

  const fontSize = PLAN_LABEL_FONT_SIZE * view.scale;
  const metrics = measure?.(draft.replaceAll("\t", " "));
  const ascent = metrics?.fontBoundingBoxAscent ?? PLAN_LABEL_FONT_SIZE * 0.8;
  const descent = metrics?.fontBoundingBoxDescent ?? PLAN_LABEL_FONT_SIZE * 0.2;
  const height = fontSize * 1.25;
  const width = Math.max(
    fontSize,
    planLabelAdvance(draft, metrics) * view.scale + 8,
  );

  return (
    <>
      {previewLayer &&
        createPortal(
          <g transform={`translate(${position.x} ${position.y})`}>
            <PlanLabelText text={draft} textRef={draftText} />
            {selection.collapsed && (
              <line
                key={selection.index}
                className={styles.labelCaret}
                x1={caretOffset}
                x2={caretOffset}
                y1={-ascent}
                y2={descent}
                stroke="var(--sp-accent)"
                vectorEffect="non-scaling-stroke"
              />
            )}
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
            (height + (ascent - descent) * view.scale) / 2,
          width,
          height,
          fontFamily: PLAN_LABEL_FONT_FAMILY,
          fontSize,
          fontWeight: ROOM_LABEL_FONT_WEIGHT,
          lineHeight: `${height}px`,
        }}
        value={draft}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          setSelection(caretSelection(event.currentTarget));
        }}
        onSelect={(event) => setSelection(caretSelection(event.currentTarget))}
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
