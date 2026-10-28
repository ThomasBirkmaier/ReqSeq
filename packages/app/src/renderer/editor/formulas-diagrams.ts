// Formulas and diagrams in the text of an element (SR-096, #108) as one plugin of the editor: the syntax
// of formulas, the preview rules of formulas and diagrams, the tooltip under a `$…$` at the caret and the
// plugin that draws the diagrams. A module constant, so the plugins of the element buffer keep their
// identity across renders.
import { diagramRule, diagrams } from "./diagram.js";
import { formulaTooltip, FORMULA_RULES } from "./formula-preview.js";
import { mathSyntax } from "./math-syntax.js";
import type { EditorPlugins } from "./plugins.js";

export const formulasAndDiagrams: EditorPlugins = {
  markdown: [mathSyntax],
  rules: [...FORMULA_RULES, diagramRule],
  extensions: [formulaTooltip, diagrams()],
};
