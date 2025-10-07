import { useApp } from "@app/store";
import clsx from "clsx";
import styles from "./WallOptions.module.css";

const PRESETS = [7, 10, 12, 15, 20, 40]; // cm

export function WallOptions() {
  const currentWallThickness = useApp((s) => s.currentWallThickness);
  const setThickness = useApp((s) => s.setCurrentWallThickness);

  return (
    <div className={styles.wallOptions} aria-label="Wall options">
      <span className={styles.label}>Thickness</span>

      <div className={styles.presets}>
        {PRESETS.map((p) => (
          <button
            key={p}
            className={clsx(
              styles.pill,
              currentWallThickness === p && styles.active
            )}
            onClick={() => setThickness(p)}
            title={`${p} cm`}
          >
            {p} cm
          </button>
        ))}
      </div>
    </div>
  );
}
