import { useApp } from "@app/store";
import { polygonToPoints } from "@geometry/junction";
import {
  ROOM_AREA_FONT_SIZE,
  ROOM_LABEL_FONT_FAMILY,
  ROOM_LABEL_FONT_SIZE,
  ROOM_LABEL_FONT_WEIGHT,
  type RoomAnnotation,
  roomAnnotationTransform,
} from "@geometry/roomLabels";
import type { Room } from "@geometry/rooms";
import styles from "./FloorPlan.module.css";

interface RoomsLayerProps {
  annotations: readonly RoomAnnotation[];
  selectedRoom?: Room;
  activateRoom: (room: Room) => void;
  onRoomFocus: (outline: string | null) => void;
}

export function RoomsLayer({
  annotations,
  selectedRoom,
  activateRoom,
  onRoomFocus,
}: RoomsLayerProps) {
  const selectable = useApp((s) => s.tool === "select");

  return (
    <g data-layer="rooms" style={{ pointerEvents: "none" }}>
      {annotations.map((annotation) => {
        const { room, name, area, label } = annotation;
        const points = polygonToPoints(room.polygon);
        const content = (
          <>
            {name &&
              (!label || label.shortened || label.nameLines.length > 1) && (
                <title>{name}</title>
              )}
            {room.nested.length ? (
              <path
                className={styles.roomFill}
                d={[room.polygon, ...room.nested]
                  .map((polygon) => `M ${polygonToPoints(polygon)} Z`)
                  .join(" ")}
                fillRule="evenodd"
                fill="var(--sp-text)"
                fillOpacity={0.045}
              />
            ) : (
              <polygon
                className={styles.roomFill}
                points={points}
                fill="var(--sp-text)"
                fillOpacity={0.045}
              />
            )}
            <text
              transform={roomAnnotationTransform(annotation)}
              textAnchor="middle"
              dominantBaseline="central"
              fontFamily={ROOM_LABEL_FONT_FAMILY}
              fontSize={label ? ROOM_LABEL_FONT_SIZE : ROOM_AREA_FONT_SIZE}
              fontWeight={400}
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
                      fontWeight={ROOM_LABEL_FONT_WEIGHT}
                      style={{ whiteSpace: "pre" }}
                    >
                      {line.text}
                    </tspan>
                  ))}
                  <tspan x={0} y={label.areaY} fontSize={ROOM_AREA_FONT_SIZE}>
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
