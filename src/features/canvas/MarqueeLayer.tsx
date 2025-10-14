import { useApp } from "@app/store";
import { rectFrom } from "@geometry/rect";
import React from "react";

export const MarqueeLayer = React.memo(function MarqueeLayer() {
  const marquee = useApp((s) => s.marquee);

  if (!marquee) return null;
  const r = rectFrom(marquee.x0, marquee.y0, marquee.x1, marquee.y1);
  return (
    <rect
      x={r.x}
      y={r.y}
      width={r.w}
      height={r.h}
      fill="var(--sp-accent)"
      fillOpacity={0.1}
      stroke="var(--sp-accent)"
      strokeDasharray="4 4"
      vectorEffect="non-scaling-stroke"
    />
  );
});
