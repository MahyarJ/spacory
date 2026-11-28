import { useApp } from "@app/store";
import { THICKNESS_PRESETS } from "@app/thickness";
import clsx from "clsx";
import { useId } from "react";
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
  const labelId = useId();

  return (
    <div className={styles.optionGroup}>
      <span id={labelId} title="Overall wall thickness">
        Thickness
      </span>
      <fieldset className={segments.group} aria-labelledby={labelId}>
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
      </fieldset>
      {custom && (
        <LengthField
          id="wall-thickness-input"
          label="Custom thickness"
          hideLabel
          lengthCm={thickness}
          minCm={1}
          system={system}
          singleUnit={system === "metric" ? "cm" : "in"}
          onCommit={setThickness}
        />
      )}
    </div>
  );
}
