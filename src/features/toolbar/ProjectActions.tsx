import { useRef } from "react";
import { useApp } from "@app/store";
import { PlanParseError, parsePlan, serializePlan } from "@app/io";
import styles from "./Toolbar.module.css";

function sanitizeFilename(name: string): string {
  const cleaned = name.trim().replace(/[^a-z0-9-_ ]/gi, "").replace(/\s+/g, "-");
  return cleaned || "spacory-plan";
}

export function ProjectActions() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const onExport = () => {
    const plan = useApp.getState().plan;
    const blob = new Blob([serializePlan(plan)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sanitizeFilename(plan.meta.name)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const onImportClick = () => fileInputRef.current?.click();

  const onFileChange: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    // Reset so picking the same file again still fires onChange.
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const plan = parsePlan(text);
      useApp.getState().loadPlan(plan);
    } catch (err) {
      const message =
        err instanceof PlanParseError
          ? err.message
          : "Could not read that file.";
      window.alert(`Import failed: ${message}`);
    }
  };

  return (
    <>
      <button className={styles.button} onClick={onImportClick}>
        Import
      </button>
      <button className={styles.button} onClick={onExport}>
        Export
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={onFileChange}
        style={{ display: "none" }}
      />
    </>
  );
}
