import { useApp } from "@app/store";
import { type RefObject, useState } from "react";
import styles from "./FloorPlan.module.css";

export function RoomNameOptions({
  name,
  inputRef,
}: {
  name: string;
  inputRef: RefObject<HTMLInputElement>;
}) {
  const setSelectedRoomName = useApp((s) => s.setSelectedRoomName);
  const [draft, setDraft] = useState({ saved: name, value: name });
  if (draft.saved !== name) setDraft({ saved: name, value: name });

  return (
    <form
      className={styles.roomOptions}
      onSubmit={(event) => {
        event.preventDefault();
        setSelectedRoomName(draft.value);
      }}
    >
      <label>
        Room name
        <input
          ref={inputRef}
          type="text"
          value={draft.value}
          onChange={(event) =>
            setDraft({ saved: name, value: event.target.value })
          }
        />
      </label>
      <button type="submit" disabled={draft.value === name}>
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
    </form>
  );
}
