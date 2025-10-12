import { createRoot } from "react-dom/client";
import App from "./App";
import "./theme.css";
import { applyThemeAttr, THEME_KEY } from "@app/theming";

applyThemeAttr?.((localStorage.getItem(THEME_KEY) as any) ?? "dark");

createRoot(document.getElementById("root")!).render(<App />);
