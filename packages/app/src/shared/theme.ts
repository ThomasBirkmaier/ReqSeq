// The sheet colour of each scheme (SR-113). The renderer's `--sheet` token (styles.css) has the same
// values; `styles.test.ts` checks that they agree. The main process uses it for the window background
// before the page has painted.
export type Scheme = "light" | "dark";

export const SHEET: Readonly<Record<Scheme, string>> = { light: "#ffffff", dark: "#16181b" };
