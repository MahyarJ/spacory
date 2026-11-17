import { formatArea } from "@app/format";
import { useApp } from "@app/store";
import { detectRooms } from "@geometry/rooms";
import { useMemo } from "react";

/** Derived visual geometry only: never persisted or included in undo history. */
export function RoomsLayer() {
  const walls = useApp((s) => s.plan.walls);
  const units = useApp((s) => s.plan.meta.units);
  const scale = useApp((s) => s.view.scale);
  const rooms = useMemo(() => detectRooms(walls), [walls]);

  return (
    <g data-layer="rooms" style={{ pointerEvents: "none" }}>
      {rooms.map((room) => (
        <g key={room.polygon.map((p) => `${p.x},${p.y}`).join(" ")}>
          <polygon
            points={room.polygon.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="var(--sp-text)"
            fillOpacity={0.045}
          />
          <text
            transform={`translate(${room.labelPoint.x} ${room.labelPoint.y}) scale(${1 / scale})`}
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily="var(--sp-font)"
            fontSize={13}
            fill="var(--sp-text)"
            stroke="var(--sp-bg)"
            strokeWidth={3}
            paintOrder="stroke"
          >
            {formatArea(room.area, units)}
          </text>
        </g>
      ))}
    </g>
  );
}
