import { formatSystemArea } from "@app/format";
import type { RoomName } from "@app/schema";
import { useApp } from "@app/store";
import { polygonToPoints } from "@geometry/junction";
import type { Room } from "@geometry/rooms";
import styles from "./FloorPlan.module.css";

interface RoomsLayerProps {
  rooms: Room[];
  names: Map<Room, RoomName>;
  selectedRoom?: Room;
  activateRoom: (room: Room) => void;
}

export function RoomsLayer({
  rooms,
  names,
  selectedRoom,
  activateRoom,
}: RoomsLayerProps) {
  const system = useApp((s) => s.plan.meta.measurementSystem);
  const scale = useApp((s) => s.view.scale);
  const selectable = useApp((s) => s.tool === "select");

  return (
    <g data-layer="rooms" style={{ pointerEvents: "none" }}>
      {rooms.map((room) => {
        const points = polygonToPoints(room.polygon);
        const name = names.get(room)?.name;
        const area = formatSystemArea(room.area, system);
        const content = (
          <>
            <polygon
              className={styles.roomFill}
              points={points}
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
              {name ? (
                <>
                  <tspan
                    x={0}
                    y={-8}
                    fontWeight={600}
                    style={{ whiteSpace: "pre" }}
                  >
                    {name}
                  </tspan>
                  <tspan x={0} y={8}>
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
