import styles from "./FloorPlan.module.css";

export function RoomFocusLayer({ outline }: { outline: string }) {
  return (
    <g
      className={styles.roomFocus}
      data-layer="room-focus"
      pointerEvents="none"
      fill="none"
      strokeDasharray="6 4"
      strokeLinejoin="round"
    >
      <polygon
        points={outline}
        stroke="var(--sp-bg)"
        strokeWidth={5}
        vectorEffect="non-scaling-stroke"
      />
      <polygon
        points={outline}
        stroke="var(--sp-accent)"
        strokeWidth={2.5}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}
