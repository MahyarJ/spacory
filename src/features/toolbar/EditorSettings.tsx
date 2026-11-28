import { IconButton } from "@ui/Button";
import { ICON_SIZE } from "@ui/constants";
import optionsStyles from "@ui/OptionsPanel.module.css";
import { Settings } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import styles from "./EditorSettings.module.css";
import { MeasurementSystemSwitch } from "./MeasurementSystemSwitch";
import { ThemeSwitch } from "./ThemeSwitch";

export function EditorSettings() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    const dismissOutside = (event: Event) => {
      if (!container?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      // Keep canvas shortcuts out of the open settings panel.
      event.stopPropagation();
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    container?.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      container?.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.settings} ref={containerRef}>
      <IconButton
        ref={triggerRef}
        label="Settings"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          if (!open) triggerRef.current?.focus();
          setOpen(!open);
        }}
      >
        <Settings size={ICON_SIZE} aria-hidden="true" />
      </IconButton>
      <section
        id={panelId}
        className={`${optionsStyles.panel} ${styles.settingsPanel}`}
        aria-label="Editor settings"
        hidden={!open}
      >
        <div>
          <p>Theme</p>
          <ThemeSwitch />
        </div>
        <div>
          <p>Measurement system</p>
          <MeasurementSystemSwitch />
        </div>
      </section>
    </div>
  );
}
