import { DEFAULT_PLAN_LABEL_TEXT, isPlanLabelText } from "@app/planLabel";
import { useApp } from "@app/store";
import { useLayoutEffect, useRef, useState } from "react";
import styles from "./FloorPlan.module.css";

export function LabelOptions({ text }: { text?: string }) {
  const saveLabel = useApp((s) => s.saveLabel);
  const removeLabel = useApp((s) => s.deleteSelected);
  const selectNone = useApp((s) => s.selectNone);
  const newText = useApp((s) =>
    s.labelSelection && "position" in s.labelSelection
      ? s.labelSelection.text
      : undefined,
  );
  const setNewLabelText = useApp((s) => s.setNewLabelText);
  const input = useRef<HTMLInputElement>(null);
  const [edit, setEdit] = useState(text ?? "");
  const creating = text === undefined;
  const draft = creating ? (newText ?? DEFAULT_PLAN_LABEL_TEXT) : edit;
  const canSave = draft !== text && isPlanLabelText(draft);

  useLayoutEffect(() => {
    if (creating) {
      input.current?.focus();
      input.current?.select();
    }
  }, [creating]);

  return (
    <form
      className={styles.textOptions}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) saveLabel(draft);
      }}
    >
      <label>
        Label text
        <input
          ref={input}
          type="text"
          value={draft}
          placeholder={creating ? DEFAULT_PLAN_LABEL_TEXT : undefined}
          onChange={(event) =>
            (creating ? setNewLabelText : setEdit)(event.target.value)
          }
          onKeyDown={(event) => {
            if (event.key === "Escape") selectNone();
          }}
        />
      </label>
      <button type="submit" disabled={!canSave}>
        Save
      </button>
      {creating ? (
        <button type="button" onClick={selectNone}>
          Cancel
        </button>
      ) : (
        <button type="button" onClick={removeLabel}>
          Remove
        </button>
      )}
    </form>
  );
}
