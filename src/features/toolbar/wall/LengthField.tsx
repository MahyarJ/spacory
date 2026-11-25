import {
  feetAndInchesToCm,
  type LengthUnit,
  lengthToCm,
  toFeetAndInches,
} from "@app/format";
import type { MeasurementSystem } from "@app/schema";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { parseDraft } from "./draftField";
import { useCommitOnClickAway } from "./useCommitOnClickAway";
import styles from "./WallOptions.module.css";

function displayValues(
  lengthCm: number,
  system: MeasurementSystem,
  precise: boolean,
  singleUnit?: LengthUnit,
) {
  if (singleUnit)
    return {
      primary: String(
        Number((lengthCm / lengthToCm(1, singleUnit)).toFixed(2)),
      ),
      inches: "0",
    };
  const { feet, inches } = toFeetAndInches(lengthCm, precise ? 4 : 1);
  return system === "metric"
    ? {
        primary: String(precise ? lengthCm : Math.round(lengthCm)),
        inches: "0",
      }
    : { primary: String(feet), inches: String(inches) };
}

/** Measurement editors share conversion, validation, and commit timing. */
export function LengthField({
  id,
  label,
  lengthCm,
  minCm,
  system,
  onCommit,
  singleUnit,
  precise = false,
  hideLabel = false,
  renderControls,
}: {
  id: string;
  label: string;
  lengthCm: number;
  minCm: number;
  system: MeasurementSystem;
  onCommit: (cm: number) => void;
  singleUnit?: LengthUnit;
  precise?: boolean;
  hideLabel?: boolean;
  renderControls?: (draftCm: number | null) => ReactNode;
}) {
  const [draft, setDraft] = useState(() =>
    displayValues(lengthCm, system, precise, singleUnit),
  );
  const dirty = useRef(false);
  const [active, setActive] = useState(false);
  useEffect(() => {
    setDraft(displayValues(lengthCm, system, precise, singleUnit));
    dirty.current = false;
  }, [lengthCm, system, precise, singleUnit]);

  const current = displayValues(lengthCm, system, precise, singleUnit);
  const draftLength = () => {
    // Rounded display text is never an edit.
    if (draft.primary === current.primary && draft.inches === current.inches)
      return null;
    const primary = parseDraft(draft.primary, 0);
    const inches = parseDraft(draft.inches, 0);
    const cm =
      primary === null || inches === null
        ? null
        : singleUnit || system === "metric"
          ? lengthToCm(primary, singleUnit ?? "cm")
          : feetAndInchesToCm(primary, inches);
    return cm !== null && Number.isFinite(cm) && cm >= minCm ? cm : null;
  };
  const finishEdit = (keepControls = false) => {
    dirty.current = false;
    if (!keepControls) setActive(false);
    // Also reset invalid or clamped drafts when the stored length doesn't change.
    setDraft(current);
  };
  const commit = ({ keepControls = false } = {}) => {
    // Blur can follow click-away. Apply the draft only once.
    const cm = dirty.current ? draftLength() : null;
    dirty.current = false;
    if (cm !== null) onCommit(cm);
    finishEdit(keepControls);
  };
  const fieldRef = useCommitOnClickAway(commit);
  const imperial = system === "imperial" && !singleUnit;

  return (
    <form
      noValidate
      ref={fieldRef}
      className={styles.lengthField}
      onFocus={renderControls ? () => setActive(true) : undefined}
      onMouseDown={
        renderControls
          ? (event) => {
              // Some browsers don't focus buttons on a click. Keep the focus
              // transition inside the form so that selecting a segment can't blur it.
              if (
                event.button === 0 &&
                event.target instanceof HTMLButtonElement
              ) {
                event.preventDefault();
                event.target.focus();
              }
            }
          : undefined
      }
      onSubmit={(event) => {
        event.preventDefault();
        commit();
      }}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLButtonElement) event.stopPropagation();
        // Two numeric inputs have no implicit Enter submission in the browser.
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
          event.preventDefault();
          commit();
        }
        if (event.key === "Escape" && active && renderControls) {
          event.preventDefault();
          event.stopPropagation();
          finishEdit();
        }
      }}
      onBlur={(event) => {
        // Moving between the inputs and resize controls keeps the draft open.
        if (event.currentTarget.contains(event.relatedTarget)) return;
        if (active && renderControls) {
          // Focus can leave before the click finishes. Save the draft now and
          // keep Move in place until the next frame so controls stay put.
          commit({ keepControls: true });
          requestAnimationFrame(() => {
            const field = fieldRef.current;
            if (field && !field.contains(document.activeElement)) {
              setActive(false);
            }
          });
          return;
        }
        commit();
      }}
    >
      {!hideLabel && (
        <label className={styles.label} htmlFor={id}>
          {label}
        </label>
      )}
      <div className={styles.lengthInputFrame}>
        <input
          id={id}
          aria-label={imperial ? `${label} feet` : label}
          type="number"
          inputMode={imperial ? "numeric" : "decimal"}
          min={imperial ? 0 : minCm / lengthToCm(1, singleUnit ?? "cm")}
          step={imperial ? 1 : "any"}
          className={styles.lengthInput}
          value={draft.primary}
          onPointerDown={renderControls ? () => setActive(true) : undefined}
          onChange={(event) => {
            dirty.current = true;
            setActive(true);
            setDraft({ ...draft, primary: event.target.value });
          }}
        />
      </div>
      <span className={styles.unit}>
        {singleUnit ?? (imperial ? "ft" : "cm")}
      </span>
      {imperial && (
        <>
          <div className={styles.lengthInputFrame}>
            <input
              aria-label={`${label} inches`}
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              className={styles.lengthInput}
              value={draft.inches}
              onPointerDown={renderControls ? () => setActive(true) : undefined}
              onChange={(event) => {
                dirty.current = true;
                setActive(true);
                setDraft({ ...draft, inches: event.target.value });
              }}
            />
          </div>
          <span className={styles.unit}>in</span>
        </>
      )}
      {active && renderControls?.(draftLength())}
    </form>
  );
}
