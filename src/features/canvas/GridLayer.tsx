import { useMemo } from "react";
import { useApp } from "@app/store";

export function GridLayer({
  width,
  height,
}: {
  width: number;
  height: number;
}) {
  const plan = useApp((s) => s.plan);
  const { scale, panX, panY } = useApp((s) => s.view);

  const step = plan.meta.gridSize;
  const lines = useMemo(() => {
    const cols: number[] = [];
    const rows: number[] = [];
    const worldLeft = -panX / scale;
    const worldTop = -panY / scale;
    const worldRight = worldLeft + width / scale;
    const worldBottom = worldTop + height / scale;

    const startX = Math.floor(worldLeft / step) * step;
    const endX = Math.ceil(worldRight / step) * step;
    for (let x = startX; x <= endX; x += step) cols.push(x);

    const startY = Math.floor(worldTop / step) * step;
    const endY = Math.ceil(worldBottom / step) * step;
    for (let y = startY; y <= endY; y += step) rows.push(y);

    return { cols, rows };
  }, [step, width, height, scale, panX, panY]);

  return (
    <g data-layer="grid">
      {lines.cols.map((x) => (
        <line
          key={"vx" + x}
          x1={x}
          y1={-1e5}
          x2={x}
          y2={1e5}
          stroke="var(--sp-grid)"
          strokeWidth={1 / scale}
        />
      ))}
      {lines.rows.map((y) => (
        <line
          key={"hz" + y}
          x1={-1e5}
          y1={y}
          x2={1e5}
          y2={y}
          stroke="var(--sp-grid)"
          strokeWidth={1 / scale}
        />
      ))}
    </g>
  );
}
