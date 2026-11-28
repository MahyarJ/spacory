import { isRoomNameTooLong, MAX_ROOM_NAME_LENGTH } from "@app/roomName";
import { useApp } from "@app/store";
import optionsStyles from "@ui/OptionsPanel.module.css";
import clsx from "clsx";
import { type RefObject, useId, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./FloorPlan.module.css";

export function RoomNameOptions({
  name,
  inputRef,
  container,
}: {
  name: string;
  inputRef: RefObject<HTMLInputElement>;
  container?: HTMLDivElement | null;
}) {
  const setSelectedRoomName = useApp((s) => s.setSelectedRoomName);
  const [draft, setDraft] = useState({ saved: name, value: name });
  const errorId = useId();
  if (draft.saved !== name) setDraft({ saved: name, value: name });
  const changed = draft.value !== name;
  const tooLong = changed && isRoomNameTooLong(draft.value);

  const form = (
    <form
      className={clsx(
        optionsStyles.panel,
        styles.textOptions,
        !container && styles.standaloneTextOptions,
      )}
      data-canvas-top-controls
      onSubmit={(event) => {
        event.preventDefault();
        if (changed && !tooLong) setSelectedRoomName(draft.value);
      }}
    >
      <label>
        Room name
        <input
          ref={inputRef}
          type="text"
          value={draft.value}
          aria-invalid={tooLong || undefined}
          aria-describedby={tooLong ? errorId : undefined}
          onChange={(event) =>
            setDraft({ saved: name, value: event.target.value })
          }
        />
      </label>
      <button type="submit" disabled={!changed || tooLong}>
        Save
      </button>
      {name && (
        <button
          type="button"
          onClick={() => {
            setSelectedRoomName("");
            inputRef.current?.focus();
          }}
        >
          Clear
        </button>
      )}
      {tooLong && (
        <span id={errorId} className={styles.roomNameError} role="alert">
          Room names can be up to {MAX_ROOM_NAME_LENGTH} characters.
        </span>
      )}
    </form>
  );
  return container ? createPortal(form, container) : form;
}
