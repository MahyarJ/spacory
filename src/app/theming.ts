export type ThemeMode = "dark" | "light" | "system";

export const THEME_KEY = "spacory.themeMode";

export function applyThemeAttr(mode: ThemeMode) {
  const el = document.documentElement;
  el.setAttribute("data-sp-theme", mode);
}

export const initialTheme = ((): ThemeMode => {
  const saved = (typeof localStorage !== "undefined" &&
    localStorage.getItem(THEME_KEY)) as ThemeMode | null;
  return saved ?? "dark";
})();
