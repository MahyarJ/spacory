import React, { useEffect, useRef, useState } from "react";
import { useApp } from "@app/store";
import type { Point, Wall } from "@app/schema";
import { snapToGrid, applyInverseViewTransform } from "@geometry/snap";
import { WallsLayer } from "./WallsLayer";
import { GridLayer } from "./GridLayer";

import styles from "./FloorPlan.module.css";

function uid(prefix = "id") {
  return prefix + "_" + Math.random().toString(36).slice(2, 9);
}

export function FloorPlan() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const addWall = useApp((s) => s.addWall);
  const plan = useApp((s) => s.plan);
  const tool = useApp((s) => s.tool);
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const isPanning = useApp((s) => s.isPanning);
  const setIsPanning = useApp((s) => s.setIsPanning);

  const [drawing, setDrawing] = useState<Point | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({
    w: 800,
    h: 600,
  });

  useEffect(() => {
    const resize = () => {
      const el = svgRef.current;
      if (!el) return;
      setSize({ w: el.clientWidth, h: el.clientHeight });
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const toWorld = (clientX: number, clientY: number) => {
    return applyInverseViewTransform(
      clientX,
      clientY,
      svgRef.current!,
      view.panX,
      view.panY,
      view.scale
    );
  };

  const onPointerDown: React.PointerEventHandler<SVGSVGElement> = (e) => {
    if (!svgRef.current) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    if (e.button === 2 || tool === "pan") {
      setIsPanning(true);
      return;
    }
    if (tool === "wall") {
      const world = toWorld(e.clientX, e.clientY);
      const snapped = snapToGrid(world, plan.meta.gridSize);
      if (!drawing) {
        setDrawing(snapped);
      } else {
        const w: Wall = {
          id: uid("wall"),
          a: drawing,
          b: snapped,
          thickness: 10,
        };
        addWall(w);
        setDrawing(null);
      }
    }
  };

  const onPointerMove: React.PointerEventHandler<SVGSVGElement> = (e) => {
    if (!svgRef.current) return;
    const world = toWorld(e.clientX, e.clientY);
    setCursor(world);

    if (isPanning) {
      setView((v) => ({
        ...v,
        panX: v.panX + e.movementX,
        panY: v.panY + e.movementY,
      }));
    }
  };

  const onPointerUp: React.PointerEventHandler<SVGSVGElement> = (e) => {
    if (!svgRef.current) return;
    (e.target as Element).releasePointerCapture(e.pointerId);
    if (isPanning) setIsPanning(false);
  };

  const onWheel: React.WheelEventHandler<SVGSVGElement> = (e) => {
    const delta = -e.deltaY;
    const factor = Math.exp(delta * 0.001);
    const worldBefore = toWorld(e.clientX, e.clientY);
    setView((v) => {
      const newScale = Math.min(8, Math.max(0.2, v.scale * factor));
      const rect = svgRef.current!.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const worldAfterX = (sx - v.panX) / newScale;
      const worldAfterY = (sy - v.panY) / newScale;
      const dx = (worldAfterX - worldBefore.x) * newScale;
      const dy = (worldAfterY - worldBefore.y) * newScale;
      return { ...v, scale: newScale, panX: v.panX + dx, panY: v.panY + dy };
    });
  };

  const viewTransform = `translate(${view.panX} ${view.panY}) scale(${view.scale})`;

  const preview = (() => {
    if (tool !== "wall" || !drawing || !cursor) return null;
    const snapped = snapToGrid(cursor, plan.meta.gridSize);
    return (
      <line
        x1={drawing.x}
        y1={drawing.y}
        x2={snapped.x}
        y2={snapped.y}
        stroke="var(--sp-accent)"
        strokeDasharray="6 4"
        strokeWidth={2}
      />
    );
  })();

  return (
    <>
      <svg
        className={styles.floorplan}
        ref={svgRef}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
      >
        <g transform={viewTransform}>
          <GridLayer width={size.w} height={size.h} />
          <WallsLayer />
          {preview}
        </g>
      </svg>
      <div className={styles.badge}>
        Tool: {tool} • Scale: {view.scale.toFixed(2)} • Pan: (
        {view.panX.toFixed(0)}, {view.panY.toFixed(0)})
      </div>
    </>
  );
}
