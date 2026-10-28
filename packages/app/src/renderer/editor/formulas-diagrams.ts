// Formulas in the text of an element (SR-096, #108) as one plugin of the editor: their syntax, their
// preview rules and the tooltip under a `$…$` at the caret. A module constant, so the plugins of the element
// buffer keep their identity across renders.
import { formulaTooltip, FORMULA_RULES } from "./formula-preview.js";
import { mathSyntax } from "./math-syntax.js";
import type { EditorPlugins } from "./plugins.js";

export const formulasAndDiagrams: EditorPlugins = {
  markdown: [mathSyntax],
  rules: FORMULA_RULES,
  extensions: [formulaTooltip],
};
