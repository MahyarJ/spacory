import { useApp } from "@app/store";
import clsx from "clsx";
import styles from "./ThemeSwitch.module.css";

export function MeasurementSystemSwitch() {
  const system = useApp((s) => s.plan.meta.measurementSystem);
  const setSystem = useApp((s) => s.setMeasurementSystem);
  return (
    <fieldset className={styles.group} aria-label="Measurement system">
      {(["metric", "imperial"] as const).map((value) => (
        <button
          key={value}
          type="button"
          className={clsx(styles.segment, system === value && styles.active)}
          aria-pressed={system === value}
          title={
            value === "metric"
              ? "Centimetres and square metres"
              : "Feet, inches and square feet"
          }
          onClick={() => setSystem(value)}
        >
          {value === "metric" ? "Metric" : "Imperial"}
        </button>
      ))}
    </fieldset>
  );
}
