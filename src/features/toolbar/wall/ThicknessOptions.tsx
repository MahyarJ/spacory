import { useApp } from "@app/store";
import { THICKNESS_PRESETS } from "@app/thickness";
import clsx from "clsx";
import segments from "../ThemeSwitch.module.css";
import { LengthField } from "./LengthField";
import styles from "./WallOptions.module.css";

export function ThicknessOptions() {
  const system = useApp((s) => s.plan.meta.measurementSystem);
  const thickness = useApp((s) => s.currentWallThickness);
  const setThickness = useApp((s) => s.setCurrentWallThickness);
  const selectedPreset = useApp((s) => s.wallThicknessPreset);
  const setPreset = useApp((s) => s.setWallThicknessPreset);
  const presets = THICKNESS_PRESETS[system];
  const custom = selectedPreset === null;

  return (
    <>
      <span className={styles.label} title="Overall wall thickness">
        Thickness
      </span>
      <div className={segments.group}>
        {presets.map(({ id, label }) => (
          <button
            key={label}
            type="button"
            className={clsx(
              segments.segment,
              selectedPreset === id && segments.active,
            )}
            aria-pressed={selectedPreset === id}
            onClick={() => {
              setPreset(id);
            }}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className={clsx(segments.segment, custom && segments.active)}
          aria-pressed={custom}
          onClick={() => setThickness(thickness)}
        >
          Custom
        </button>
      </div>
      {custom && (
        <LengthField
          id="wall-thickness-input"
          label="Custom thickness"
          lengthCm={thickness}
          minCm={1}
          system={system}
          singleUnit={system === "metric" ? "cm" : "in"}
          onCommit={setThickness}
        />
      )}
    </>
  );
}
