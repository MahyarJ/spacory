import { useApp } from "@app/store";
import { SegmentedControl } from "./SegmentedControl";

const options = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
] as const;

export function ThemeSwitch() {
  const mode = useApp((s) => s.themeMode);
  const setMode = useApp((s) => s.setThemeMode);

  return (
    <SegmentedControl
      label="Theme"
      options={options}
      value={mode}
      onChange={setMode}
    />
  );
}
