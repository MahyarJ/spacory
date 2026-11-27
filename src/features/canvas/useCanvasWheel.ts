import { useApp } from "@app/store";
import { type CanvasPoint, type ViewState, zoomView } from "@app/viewport";
import { type RefObject, useEffect } from "react";

type SafariGestureEvent = Event & {
  clientX: number;
  clientY: number;
  scale: number;
};

const WHEEL_ZOOM_RATE = 0.001;
const LINE_HEIGHT = 16;

export function useCanvasWheel(
  svgRef: RefObject<SVGSVGElement>,
  pointers: RefObject<Map<number, CanvasPoint>>,
) {
  useEffect(() => {
    const svg = svgRef.current!;
    const { setView } = useApp.getState();
    let trackpadPinch: { view: ViewState; anchor: CanvasPoint } | null = null;

    const anchorAt = (clientX: number, clientY: number): CanvasPoint => {
      const { left, top } = svg.getBoundingClientRect();
      return { x: clientX - left, y: clientY - top };
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (trackpadPinch || pointers.current?.size) return;

      const { deltaMode, deltaX, deltaY } = event;
      const unitX =
        deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? svg.clientWidth
          : deltaMode === WheelEvent.DOM_DELTA_LINE
            ? LINE_HEIGHT
            : 1;
      const unitY =
        deltaMode === WheelEvent.DOM_DELTA_PAGE ? svg.clientHeight : unitX;

      if (event.ctrlKey || event.metaKey) {
        const anchor = anchorAt(event.clientX, event.clientY);
        setView((view) =>
          zoomView(view, Math.exp(-deltaY * unitY * WHEEL_ZOOM_RATE), anchor),
        );
      } else {
        setView((view) => ({
          ...view,
          panX: view.panX - deltaX * unitX,
          panY: view.panY - deltaY * unitY,
        }));
      }
    };

    // Safari reports desktop trackpad pinch through a gesture event. Touchscreen
    // contacts use the pointer-based pinch path already.
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      if (pointers.current?.size) return;
      const { clientX, clientY } = event as SafariGestureEvent;
      trackpadPinch = {
        view: useApp.getState().view,
        anchor: anchorAt(clientX, clientY),
      };
    };

    const onGestureChange = (event: Event) => {
      event.preventDefault();
      if (!trackpadPinch || pointers.current?.size) return;
      const { scale } = event as SafariGestureEvent;
      if (Number.isFinite(scale) && scale > 0) {
        const { view, anchor } = trackpadPinch;
        setView(() => zoomView(view, scale, anchor));
      }
    };

    const onGestureEnd = () => {
      trackpadPinch = null;
    };

    svg.addEventListener("wheel", onWheel, { passive: false });
    svg.addEventListener("gesturestart", onGestureStart);
    svg.addEventListener("gesturechange", onGestureChange);
    window.addEventListener("gestureend", onGestureEnd, true);
    window.addEventListener("blur", onGestureEnd);
    return () => {
      svg.removeEventListener("wheel", onWheel);
      svg.removeEventListener("gesturestart", onGestureStart);
      svg.removeEventListener("gesturechange", onGestureChange);
      window.removeEventListener("gestureend", onGestureEnd, true);
      window.removeEventListener("blur", onGestureEnd);
    };
  }, [svgRef, pointers]);
}
