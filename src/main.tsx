import { createRoot } from "react-dom/client";
import App from "./App";
import "./theme.css";
import { applyThemeAttr, THEME_KEY, type ThemeMode } from "@app/theming";

applyThemeAttr((localStorage.getItem(THEME_KEY) as ThemeMode | null) ?? "dark");

createRoot(document.getElementById("root")!).render(<App />);
