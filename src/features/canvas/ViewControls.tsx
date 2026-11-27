import { useApp } from "@app/store";
import { MAX_SCALE, MIN_SCALE, zoomView } from "@app/viewport";
import { Button, IconButton } from "@ui/Button";
import { ICON_SIZE } from "@ui/constants";
import { FloatingBar } from "@ui/FloatingBar";
import { createPlanLabelMeasurer } from "@ui/planLabelMeasurer";
import { Maximize, Minus, Plus } from "lucide-react";
import { useRef } from "react";
import styles from "./ViewControls.module.css";

const ZOOM_STEP = 1.25;

export function ViewControls() {
  const controls = useRef<HTMLFieldSetElement>(null);
  const view = useApp((s) => s.view);

  const zoom = (factor: number) => {
    const { canvasSize, setView } = useApp.getState();
    setView((current) =>
      zoomView(current, factor, {
        x: canvasSize.width / 2,
        y: canvasSize.height / 2,
      }),
    );
  };

  const fit = () => {
    const panel = controls.current!;
    const app = panel.parentElement!;
    const viewport = app.getBoundingClientRect();
    const top = Array.from(
      app.querySelectorAll("[data-canvas-top-controls]"),
    ).reduce(
      (end, overlay) => Math.max(end, overlay.getBoundingClientRect().bottom),
      viewport.top,
    );
    useApp.getState().fitView(createPlanLabelMeasurer(), {
      top: top - viewport.top,
      bottom: viewport.bottom - panel.getBoundingClientRect().top,
    });
  };

  return (
    <FloatingBar
      ref={controls}
      className={styles.viewControls}
      aria-label="Canvas view"
    >
      <IconButton
        label="Zoom out"
        disabled={view.scale <= (view.minScale ?? MIN_SCALE)}
        onClick={() => zoom(1 / ZOOM_STEP)}
      >
        <Minus size={ICON_SIZE} aria-hidden="true" />
      </IconButton>
      <span className={styles.zoomLevel} title="Zoom level">
        {view.scale < 0.01 ? "<1" : Math.round(view.scale * 100)}%
      </span>
      <IconButton
        label="Zoom in"
        disabled={view.scale >= MAX_SCALE}
        onClick={() => zoom(ZOOM_STEP)}
      >
        <Plus size={ICON_SIZE} aria-hidden="true" />
      </IconButton>
      <Button
        variant="text"
        className={styles.fit}
        aria-label="Fit plan in view"
        title="Fit plan in view"
        onClick={fit}
      >
        <Maximize size={ICON_SIZE} aria-hidden="true" />
        Fit
      </Button>
    </FloatingBar>
  );
}
