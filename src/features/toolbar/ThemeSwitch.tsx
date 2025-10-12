import { useApp } from "@app/store";
import styles from "./ThemeSwitch.module.css";
import clsx from "clsx";

const options = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
] as const;

export function ThemeSwitch() {
  const mode = useApp((s) => s.themeMode);
  const setMode = useApp((s) => s.setThemeMode);

  return (
    <div className={styles.themeSwitch} role="tablist" aria-label="Theme">
      {options.map(({ value, label }) => (
        <button
          key={value}
          role="tab"
          aria-selected={mode === value}
          className={clsx(styles.btn, mode === value && styles.active)}
          onClick={() => setMode(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
