import { feetAndInchesToCm, toFeetAndInches } from "@app/format";
import type { MeasurementSystem } from "@app/schema";
import { useEffect, useRef, useState } from "react";
import { parseDraft } from "./draftField";
import { useCommitOnClickAway } from "./useCommitOnClickAway";
import styles from "./WallOptions.module.css";

function displayValues(lengthCm: number, system: MeasurementSystem) {
  const { feet, inches } = toFeetAndInches(lengthCm);
  return system === "metric"
    ? { primary: String(Math.round(lengthCm)), inches: "0" }
    : { primary: String(feet), inches: String(inches) };
}

/** Both editors share conversion, validation, and commit timing. */
export function LengthField({
  id,
  label,
  lengthCm,
  minCm,
  system,
  onCommit,
}: {
  id: string;
  label: string;
  lengthCm: number;
  minCm: number;
  system: MeasurementSystem;
  onCommit: (cm: number) => void;
}) {
  const [draft, setDraft] = useState(() => displayValues(lengthCm, system));
  const dirty = useRef(false);
  useEffect(() => {
    setDraft(displayValues(lengthCm, system));
    dirty.current = false;
  }, [lengthCm, system]);

  const commit = () => {
    // Blur can follow click-away. More importantly, rounded text is never an edit.
    if (!dirty.current) return;
    dirty.current = false;
    const current = displayValues(lengthCm, system);
    if (draft.primary === current.primary && draft.inches === current.inches)
      return;
    const primary = parseDraft(draft.primary, 0);
    const inches = parseDraft(draft.inches, 0);
    const cm =
      primary === null || inches === null
        ? null
        : system === "metric"
          ? primary
          : feetAndInchesToCm(primary, inches);
    if (cm !== null && Number.isFinite(cm) && cm >= minCm) onCommit(cm);
    // Also reset invalid or clamped drafts when the stored length doesn't change.
    setDraft(current);
  };
  const fieldRef = useCommitOnClickAway(commit);
  const imperial = system === "imperial";

  return (
    <form
      noValidate
      ref={fieldRef}
      className={styles.lengthField}
      onSubmit={(event) => {
        event.preventDefault();
        commit();
      }}
      onKeyDown={(event) => {
        // Two numeric inputs have no implicit Enter submission in the browser.
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
      }}
      onBlur={(event) => {
        // Moving between feet and inches must not commit half of an edit.
        if (!event.currentTarget.contains(event.relatedTarget)) commit();
      }}
    >
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        aria-label={imperial ? `${label} feet` : label}
        type="number"
        inputMode={imperial ? "numeric" : "decimal"}
        min={imperial ? 0 : minCm}
        step={imperial ? 1 : "any"}
        className={styles.lengthInput}
        value={draft.primary}
        onChange={(event) => {
          dirty.current = true;
          setDraft({ ...draft, primary: event.target.value });
        }}
      />
      <span className={styles.unit}>{imperial ? "ft" : "cm"}</span>
      {imperial && (
        <>
          <input
            aria-label={`${label} inches`}
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            className={styles.lengthInput}
            value={draft.inches}
            onChange={(event) => {
              dirty.current = true;
              setDraft({ ...draft, inches: event.target.value });
            }}
          />
          <span className={styles.unit}>in</span>
        </>
      )}
    </form>
  );
}
