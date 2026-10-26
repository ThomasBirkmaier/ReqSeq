// Light and dark (SR-113). Without a choice the page follows the system (`prefers-color-scheme`, which
// Chromium takes from the OS through Electron's nativeTheme), at start and while it runs. The action
// "Toggle dark mode" chooses the other scheme for the running app: the choice is the attribute
// `data-theme` on the root element, which styles.css reacts to. Nothing is stored (AK1: every start
// follows the system), so the DOM is the only state.
import type { Scheme } from "../shared/theme.js";

export interface Theme {
  /** The scheme on screen: the chosen one, else the system's. */
  shown(): Scheme;
  /** A command chose the scheme (the system no longer decides). */
  chosen(): boolean;
  /** Chooses the other scheme than the one on screen; returns it. */
  toggle(): Scheme;
  /** Drops the choice: the system decides again. */
  follow(): void;
}

export const createTheme = (root: HTMLElement, system: Pick<MediaQueryList, "matches">): Theme => {
  const shown = (): Scheme => {
    const choice = root.dataset["theme"];
    if (choice === "light" || choice === "dark") {
      return choice;
    }
    return system.matches ? "dark" : "light";
  };
  return {
    shown,
    chosen: () => root.dataset["theme"] !== undefined,
    toggle: () => {
      const next: Scheme = shown() === "dark" ? "light" : "dark";
      root.dataset["theme"] = next;
      return next;
    },
    follow: () => {
      delete root.dataset["theme"];
    },
  };
};
