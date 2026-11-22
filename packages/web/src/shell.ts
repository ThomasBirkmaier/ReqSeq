// What the desktop shell does differently (ADR-0020, Front end; ADR-0021, Pages): open an address outside the page,
// and choose a folder or a file. In the browser a link opens in a new browsing context and a path is typed in a
// field whose completion comes from `workspace.listFolder`; in the window of the desktop shell (`isTauri()`) the
// address goes to the shell's `open_address`, which hands it to the program the operating system names (SR-252
// AK3), and a path field also offers the operating system's dialog, whose path goes into the field like a typed one
// (SR-253). The pages reach the shell only through this module.
import { invoke, isTauri } from "@tauri-apps/api/core";
import { ReqSeqError, call } from "./api.js";
import { h } from "./dom.js";

/** Whether the page is shown in the window of the desktop shell. */
export const inShell = (): boolean => isTauri();

/**
 * Opens `address` outside the page, on a person's input only (SR-252 AK9): in the desktop shell through
 * `open_address`, which refuses the own server and every address that is not a full http, https or mailto address
 * and rejects with its reason; in a browser in a new browsing context without opener.
 */
export async function openAddress(address: string): Promise<void> {
  if (inShell()) {
    await invoke("open_address", { address });
    return;
  }
  window.open(address, "_blank", "noopener,noreferrer");
}

/**
 * Makes a click on `link` open its address through `openAddress` in the desktop shell, where the window loads
 * nothing but its server; in a browser the link keeps its `target`. A refusal or a failed opener shows as a note
 * after the link.
 */
export function opensOutside(link: HTMLAnchorElement): void {
  link.addEventListener("click", (event) => {
    if (!inShell()) {
      return;
    }
    event.preventDefault();
    const address = link.getAttribute("href") ?? "";
    if (link.nextElementSibling?.classList.contains("open-failed") === true) {
      link.nextElementSibling.remove();
    }
    openAddress(address).catch((error: unknown) => {
      const reason =
        typeof error === "string" ? error : error instanceof Error ? error.message : String(error);
      link.after(h("span", { class: "notice bad open-failed", role: "alert" }, ` ${reason}`));
    });
  });
}

/** What a path field takes: a folder, an existing file, or the target of a file that a command writes. */
export type PathKind = "folder" | "file" | "target";

/** The shell's command for the dialog of each kind (ADR-0021, Capabilities). */
const PICK: Readonly<Record<PathKind, string>> = {
  folder: "pick_folder",
  file: "pick_file",
  target: "pick_save_target",
};

/**
 * Asks the desktop shell for the dialog of the operating system for `kind`, opening where `typed` points: its
 * folder, and for a target its file name. The shell takes only an absolute folder and a plain file name and leaves
 * the rest to the operating system. Resolves with the chosen absolute path, or null when the person cancelled or
 * the dialog could not open.
 */
export async function choosePath(kind: PathKind, typed: string): Promise<string | null> {
  const path = typed.trim();
  const { prefix } = prefixOf(path);
  const start = kind === "folder" ? path : prefix;
  const name = kind === "target" ? path.slice(prefix.length) : "";
  return invoke<string | null>(PICK[kind], {
    ...(start === "" ? {} : { start }),
    ...(name === "" ? {} : { name }),
  });
}

export interface PathFieldOptions {
  /** The label of the field. */
  readonly label: string;
  /** What the field takes; in the desktop shell it also offers the dialog of the operating system for it. */
  readonly kind: PathKind;
  /** The path the field starts with. */
  readonly value?: string;
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

/**
 * A labelled path field with completion; `input` holds the path. In the desktop shell a button beside it opens the
 * dialog of the operating system, and the chosen path replaces the field's text, as if it was typed (SR-253).
 */
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
        ...(options.kind === "folder" ? {} : { files: true }),
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
      ...out.entries.slice(0, 200).map((entry) => {
        // A link may lead to a file; in a field for a file it gets no separator.
        const folder = entry.kind === "folder" || (entry.kind === "link" && options.kind === "folder");
        return h("option", { value: `${prefix}${entry.name}${folder ? sep : ""}` });
      }),
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
      inShell() ? h("div", { class: "pathrow" }, input, chooseButton(options, input)) : input,
      list,
      options.help === undefined ? null : h("p", { class: "fhelp", id: `${id}-help` }, options.help),
    ),
  };
}

/** The button of a path field in the desktop shell that opens the dialog and puts the chosen path into `input`. */
function chooseButton(options: PathFieldOptions, input: HTMLInputElement): HTMLButtonElement {
  const button = h(
    "button",
    { type: "button", class: "btn choose", "aria-label": `Choose… ${options.label}` },
    "Choose…",
  );
  button.addEventListener("click", () => {
    const row = button.parentElement;
    if (row?.nextElementSibling?.classList.contains("choose-failed") === true) {
      row.nextElementSibling.remove();
    }
    button.disabled = true;
    choosePath(options.kind, input.value)
      .then((chosen) => {
        if (chosen !== null) {
          input.value = chosen;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.focus();
        }
      })
      .catch((error: unknown) => {
        const reason =
          typeof error === "string" ? error : error instanceof Error ? error.message : String(error);
        row?.after(h("p", { class: "notice bad choose-failed", role: "alert" }, reason));
      })
      .finally(() => {
        button.disabled = false;
      });
  });
  return button;
}

/**
 * The absolute path of the folder `typed` names, as `workspace.listFolder` reads it: `~` is the home folder. A
 * path that is not absolute is refused, since the server and the commands would resolve it from different folders.
 */
export async function absoluteFolder(typed: string): Promise<string> {
  const trimmed = typed.trim().replace(/[\\/]+$/, "");
  const out = await call("workspace.listFolder", { path: `${trimmed}/`, absolute: true });
  if (trimmed === "" || out.folder === undefined || out.problem === "invalid") {
    throw new ReqSeqError(0, { code: "ui.path-not-absolute", message: `Not a full path: ${typed}` }, "open");
  }
  return out.folder;
}
