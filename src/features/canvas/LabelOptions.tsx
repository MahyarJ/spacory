import { isPlanLabelText } from "@app/planLabel";
import { useApp } from "@app/store";
import { useLayoutEffect, useRef, useState } from "react";
import styles from "./FloorPlan.module.css";

export function LabelOptions({ text }: { text?: string }) {
  const saveLabel = useApp((s) => s.saveLabel);
  const removeLabel = useApp((s) => s.deleteSelected);
  const selectNone = useApp((s) => s.selectNone);
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(text ?? "");
  const creating = text === undefined;
  const canSave = draft !== text && isPlanLabelText(draft);

  useLayoutEffect(() => {
    if (creating) input.current?.focus();
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
          onChange={(event) => setDraft(event.target.value)}
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
