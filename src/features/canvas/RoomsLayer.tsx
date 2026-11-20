import { formatSystemArea } from "@app/format";
import type { RoomName } from "@app/schema";
import { useApp } from "@app/store";
import { polygonToPoints } from "@geometry/junction";
import { layoutRoomLabel, ROOM_LABEL_FONT_SIZE } from "@geometry/roomLabels";
import type { Room } from "@geometry/rooms";
import { createRoomLabelMeasurer } from "@ui/roomLabelMeasurer";
import { useMemo } from "react";
import styles from "./FloorPlan.module.css";

interface RoomsLayerProps {
  rooms: Room[];
  names: Map<Room, RoomName>;
  selectedRoom?: Room;
  activateRoom: (room: Room) => void;
  onRoomFocus: (outline: string | null) => void;
}

export function RoomsLayer({
  rooms,
  names,
  selectedRoom,
  activateRoom,
  onRoomFocus,
}: RoomsLayerProps) {
  const system = useApp((s) => s.plan.meta.measurementSystem);
  const scale = useApp((s) => s.view.scale);
  const selectable = useApp((s) => s.tool === "select");
  const measure = useMemo(
    () =>
      createRoomLabelMeasurer(
        getComputedStyle(document.documentElement)
          .getPropertyValue("--sp-font")
          .trim() || undefined,
      ),
    [],
  );

  return (
    <g data-layer="rooms" style={{ pointerEvents: "none" }}>
      {rooms.map((room) => {
        const points = polygonToPoints(room.polygon);
        const name = names.get(room)?.name;
        const area = formatSystemArea(room.area, system);
        const label = name
          ? layoutRoomLabel(room, name, area, scale, measure)
          : null;
        const content = (
          <>
            {label && (label.shortened || label.nameLines.length > 1) && (
              <title>{name}</title>
            )}
            <polygon
              className={styles.roomFill}
              points={points}
              fill="var(--sp-text)"
              fillOpacity={0.045}
            />
            <text
              transform={`translate(${room.labelPoint.x} ${room.labelPoint.y}) scale(${(label?.fontScale ?? 1) / scale})`}
              textAnchor="middle"
              dominantBaseline="central"
              fontFamily="var(--sp-font)"
              fontSize={label ? ROOM_LABEL_FONT_SIZE : 13}
              fill="var(--sp-text)"
              stroke="var(--sp-bg)"
              strokeWidth={3}
              paintOrder="stroke"
            >
              {label ? (
                <>
                  {label.nameLines.map((line) => (
                    <tspan
                      key={line.y}
                      x={0}
                      y={line.y}
                      fontWeight={600}
                      style={{ whiteSpace: "pre" }}
                    >
                      {line.text}
                    </tspan>
                  ))}
                  <tspan x={0} y={label.areaY}>
                    {area}
                  </tspan>
                </>
              ) : (
                area
              )}
            </text>
          </>
        );
        return selectable ? (
          // biome-ignore lint/a11y/useSemanticElements: The SVG group needs a role to expose its keyboard-operated room label as a button.
          <g
            key={points}
            className={styles.room}
            role="button"
            tabIndex={0}
            aria-label={`${name ?? "Room"}, ${area}`}
            aria-pressed={room === selectedRoom}
            onFocus={() => onRoomFocus(points)}
            onBlur={() => onRoomFocus(null)}
            onClick={(event) => {
              if (event.detail === 0) activateRoom(room);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                activateRoom(room);
              }
            }}
          >
            {content}
          </g>
        ) : (
          <g key={points}>{content}</g>
        );
      })}
    </g>
  );
}
