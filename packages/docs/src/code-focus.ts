// A tab stop on each code block of the documentation site (#2190): a block whose lines are wider than the page scrolls
// sideways, and a keyboard user can only scroll it once it can take the focus (WCAG 2.1.1, axe-core rule
// scrollable-region-focusable). Expressive Code adds `tabindex` in the browser only after the page has loaded and
// only to a block that scrolls at that moment; this plugin writes it into the built page, so it is there without
// script and at every width. Expressive Code's own script still removes it from a block that does not scroll.
// The site registers the plugin in packages/docs/site/astro.config.mjs.

/** The part of a HAST node the plugin reads and changes. */
export interface HastNode {
  readonly type: string;
  readonly tagName?: string;
  properties?: Record<string, unknown>;
  readonly children?: readonly HastNode[];
}

/** The plugin as Expressive Code takes it (`ExpressiveCodePlugin`, reduced to the hook it uses). */
export interface CodeFocusPlugin {
  readonly name: string;
  readonly hooks: {
    readonly postprocessRenderedBlock: (context: {
      readonly renderData: { readonly blockAst: HastNode };
    }) => void;
  };
}

/** Gives every `pre` element below `node` the property `tabindex="0"`; gives their number. */
export function addCodeTabStops(node: HastNode): number {
  let count = 0;
  if (node.type === "element" && node.tagName === "pre") {
    node.properties = { ...node.properties, tabindex: "0" };
    count += 1;
  }
  for (const child of node.children ?? []) {
    count += addCodeTabStops(child);
  }
  return count;
}

/** The Expressive Code plugin that gives the `pre` of each rendered code block a tab stop. */
export function focusableCodeBlocks(): CodeFocusPlugin {
  return {
    name: "Focusable code blocks",
    hooks: {
      postprocessRenderedBlock: ({ renderData }) => {
        addCodeTabStops(renderData.blockAst);
      },
    },
  };
}
