// The view of the workspace the window shows (SR-043 AK1, SR-041 AK1, D-062): all elements (no view), the
// core, or one variant, chosen with "Choose view". Core computes every view (`selection.view`, `view`);
// the app only passes the chosen one to the reads that show or count a set of elements, and the modeline
// says which one it is. The choices are `core` and the elements of the types with the meaning `variant`
// (`metamodel.get`, `element.list`), the same source as a `view` argument of the command prompt (#285).
import type { CommandTypes } from "@reqseq/core";
import type { Call } from "./call.js";

/** A view the window can show: `core` or a variant's UUID, with the title the modeline gives it. */
export interface ShownView {
  readonly view: string;
  readonly title: string;
  /** The variant's short ID, which the prompt shows before the title; none for the core. */
  readonly shortId?: string;
}

/** The view of the core requirements (SR-043 AK9). */
export const CORE_VIEW: ShownView = { view: "core", title: "Core" };

/** How the prompt lists a view: the short ID and the title of a variant, "Core" for the core. */
export const viewName = (shown: ShownView): string =>
  shown.shortId === undefined ? shown.title : `${shown.shortId} ${shown.title}`;

/** The part of the modeline that names the view shown; none while all elements are shown. */
export const viewMark = (shown: ShownView | undefined): string | undefined =>
  shown === undefined ? undefined : `view: ${shown.title}`;

/** The reads that take the view in their selection (`selection.view`). */
const IN_SELECTION: ReadonlySet<string> = new Set([
  "element.list",
  "element.search",
  "element.facets",
  "trace.matrix",
  "evidence.status",
  "evidence.coverage",
  "evidence.degree",
  "data.export",
]);

/** The reads that take the view as a field of their own (`view`). */
const AS_FIELD: ReadonlySet<string> = new Set([
  "trace.chain",
  "trace.related",
  "trace.neighbourhood",
  "trace.graph",
  "evidence.list",
  "evidence.withoutPassedTest",
]);

type Input = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Input => typeof value === "object" && value !== null;

/**
 * The input with `view` where the command takes it. An input that names a view keeps it, and a selection
 * by `ids` names elements rather than a set to show (the values of one element, the names of buffers), so
 * it reads them in every view. Every other command, writes and `element.get` among them, is left as it is.
 */
export const withView = (name: string, input: Input, view: string): Input => {
  if (AS_FIELD.has(name)) {
    return input["view"] === undefined ? { ...input, view } : input;
  }
  if (!IN_SELECTION.has(name)) {
    return input;
  }
  const selection = isRecord(input["selection"]) ? input["selection"] : {};
  return selection["view"] !== undefined || selection["ids"] !== undefined
    ? input
    : { ...input, selection: { ...selection, view } };
};

/** `call` in the view `shown`; without one, `call` itself (all elements). */
export const inView = (call: Call, shown: ShownView | undefined): Call =>
  shown === undefined
    ? call
    : (name, input) =>
        call(name, withView(name, input, shown.view) as Partial<CommandTypes[typeof name]["input"]>);

/** The views of the workspace: the core first, then each variant by its short ID and title; or why they could not be read. */
export const viewsOf = async (
  call: Call,
): Promise<
  | { readonly ok: true; readonly views: readonly ShownView[] }
  | { readonly ok: false; readonly message: string }
> => {
  const metamodel = await call("metamodel.get", {});
  if (!metamodel.ok) {
    return { ok: false, message: metamodel.message };
  }
  const types = metamodel.output.types.filter((type) => type.meaning === "variant").map((type) => type.key);
  if (types.length === 0) {
    return { ok: true, views: [CORE_VIEW] };
  }
  const variants = await call("element.list", { selection: { where: { type: types } }, limit: 5000 });
  if (!variants.ok) {
    return { ok: false, message: variants.message };
  }
  return {
    ok: true,
    views: [
      CORE_VIEW,
      ...variants.output.elements.map((variant) => ({
        view: variant.id,
        title: variant.title,
        shortId: variant.shortId,
      })),
    ],
  };
};
