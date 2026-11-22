// What a desktop shell would do differently (ADR-0020, Front end): choose a folder or a file. In the browser this
// is a path field whose completion comes from `workspace.listFolder`; a desktop shell would be a second
// implementation of this module.
import { call } from "./api.js";
import { h } from "./dom.js";

export interface PathFieldOptions {
  /** The label of the field. */
  readonly label: string;
  /** The path the field starts with. */
  readonly value?: string;
  /** Also complete file names, for a field that takes a file. */
  readonly files?: boolean;
  /** Take an absolute path, with `~` for the home folder (opening and creating a workspace). */
  readonly absolute?: boolean;
  /** A line under the field. */
  readonly help?: string;
  readonly name: string;
}

let fields = 0;

/** The part of `typed` up to its last separator, and the separator it uses. */
const prefixOf = (typed: string): { readonly prefix: string; readonly sep: string } => {
  const at = Math.max(typed.lastIndexOf("/"), typed.lastIndexOf("\\"));
  const sep = typed.includes("\\") && !typed.includes("/") ? "\\" : "/";
  return { prefix: at === -1 ? "" : typed.slice(0, at + 1), sep };
};

/** A labelled path field with completion; `input` holds the path. */
export function pathField(options: PathFieldOptions): {
  readonly box: HTMLElement;
  readonly input: HTMLInputElement;
} {
  fields += 1;
  const id = `path-${String(fields)}`;
  const list = h("datalist", { id: `${id}-list` });
  const input = h("input", {
    id,
    name: options.name,
    type: "text",
    class: "pathin",
    value: options.value ?? "",
    list: `${id}-list`,
    autocomplete: "off",
    spellcheck: "false",
    "aria-describedby": options.help === undefined ? null : `${id}-help`,
  });
  let asked = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const complete = async (): Promise<void> => {
    const mine = ++asked;
    const typed = input.value;
    let out;
    try {
      out = await call("workspace.listFolder", {
        path: typed,
        ...(options.files === true ? { files: true } : {}),
        ...(options.absolute === true ? { absolute: true } : {}),
      });
    } catch {
      return;
    }
    if (mine !== asked) {
      return;
    }
    const { prefix, sep } = prefixOf(typed);
    list.replaceChildren(
      ...out.entries
        .slice(0, 200)
        .map((entry) => h("option", { value: `${prefix}${entry.name}${entry.kind === "file" ? "" : sep}` })),
    );
  };
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => void complete(), 150);
  });
  input.addEventListener("focus", () => void complete(), { once: true });
  return {
    input,
    box: h(
      "div",
      { class: "fld" },
      h("label", { for: id }, options.label),
      input,
      list,
      options.help === undefined ? null : h("p", { class: "fhelp", id: `${id}-help` }, options.help),
    ),
  };
}
