// The theme: System follows the operating system, Light and Dark are chosen. The choice is a preference of the
// browser; `data-theme` on the root element selects the colours of base.css.
import { preference, setPreference } from "./preferences.js";

export type Theme = "system" | "light" | "dark";

export const theme = (): Theme => {
  const value = preference("theme", "system");
  return value === "light" || value === "dark" ? value : "system";
};

export function applyTheme(chosen: Theme = theme()): void {
  if (chosen === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", chosen);
  }
}

export function setTheme(chosen: Theme): void {
  setPreference("theme", chosen);
  applyTheme(chosen);
}
