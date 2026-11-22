// The workspace area: open, create and switch workspaces (`#/w/open`), the problems ReqSeq finds in the workspace
// (`#/w/problems` and the queue `problems`), exports into the repositories (`#/w/export`), the ReqIF import
// (`#/w/import`) and the settings (`#/w/settings`). Every result is what a catalog command answers; the page writes
// no file and reads none itself.
import "../css/workspace.css";
import type { OutputOf } from "../api.js";
import { ReqSeqError, call, openWorkspace } from "../api.js";
import type { Child } from "../dom.js";
import { announce, h } from "../dom.js";
import { addRailSection, errorBox, frame, prepareRail, showNotMarked } from "../layout.js";
import { relKind, statusName, typeName } from "../meaning.js";
import { addQueue } from "../queues.js";
import type { QueueRow } from "../queues.js";
import type { Route } from "../router.js";
import { addRoute, hashOf, isCurrent, withFrom } from "../router.js";
import { el, load, refOf, store } from "../store.js";
import { absoluteFolder, pathField } from "../shell.js";
import { mappingFields } from "../reqif-editor.js";
import type { Mapping } from "../reqif-mapping.js";
import { emptyMapping, withChoices } from "../reqif-mapping.js";
import type { Theme } from "../theme.js";
import { setTheme, theme } from "../theme.js";

const AREA = "w";
/** The page to open or create a workspace; the only page while the server has none open. */
export const WORKSPACES = "/w/open";
/** Raised on the window when this page opened a workspace and the store has read it. */
export const WORKSPACE_OPENED = "reqseq:workspace-opened";

type Problem = OutputOf<"workspace.check">["problems"][number];

// ---------------------------------------------------------------------------------------------------------------
// Shared pieces

let open = true;
/** Whether the server has a workspace open; `main.ts` sets it when a read says none is open. */
export const isWorkspaceOpen = (): boolean => open;
export function setWorkspaceOpen(value: boolean): void {
  open = value;
}
/** Whether a workspace is open and the store has read it. */
const isOpen = (): boolean => open && store.epoch > 0;

const head = (title: string, sub: string): HTMLElement =>
  h("div", { class: "lh" }, h("h1", { id: "list-h" }, title), sub === "" ? null : h("p", null, sub));

/** A page of this area: in the frame when a workspace is open, else on its own. */
const page = (key: string, title: string, sub: string, ...body: Child[]): HTMLElement => {
  const content = h(
    "section",
    { class: "wpage", "aria-labelledby": "list-h", "data-ws": store.workspaceName },
    head(title, sub),
    h("div", { class: "wbody" }, body),
  );
  return isOpen()
    ? frame(key, content, { wide: true })
    : h("main", { id: "main", tabindex: -1, class: "wsolo" }, content);
};

let cards = 0;

/** A part of a page, named by its heading. */
const card = (title: string, ...body: Child[]): HTMLElement => {
  cards += 1;
  const id = `wc-${String(cards)}`;
  return h("section", { class: "wcard", "aria-labelledby": id }, h("h2", { id }, title), body);
};

/** The text of a path as ReqSeq wrote it, selectable. */
const path = (text: string): HTMLElement => h("code", { class: "wpath" }, text);

const problemList = (problems: readonly Problem[] | undefined): Child =>
  problems === undefined || problems.length === 0
    ? null
    : h(
        "ul",
        { class: "wproblems" },
        problems.map((p) =>
          h("li", { class: `sev-${p.severity}` }, h("span", { class: "sev" }, p.severity), p.message),
        ),
      );

/** The answer of a command: ReqSeq's sentence, then what the page adds. */
const result = (answer: string, ...more: Child[]): HTMLElement =>
  h("div", { class: "notice wok", role: "status" }, h("p", null, answer), more);

/**
 * Runs `action` when `button` is pressed: the button waits, and the answer or the error goes into `out`, which
 * is a live region.
 */
function onPress(
  button: HTMLButtonElement,
  out: HTMLElement,
  action: () => Promise<HTMLElement | null>,
): void {
  button.addEventListener("click", () => {
    void (async () => {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      out.replaceChildren();
      try {
        const shown = await action();
        if (shown !== null) {
          out.replaceChildren(shown);
        }
      } catch (error) {
        out.replaceChildren(errorBox(error));
      } finally {
        button.disabled = false;
        button.removeAttribute("aria-busy");
      }
    })();
  });
}

const button = (text: string, primary = true): HTMLButtonElement =>
  h("button", { type: "button", class: primary ? "btn primary" : "btn" }, text);

const textField = (
  label: string,
  name: string,
  value = "",
  help?: string,
): { readonly box: HTMLElement; readonly input: HTMLInputElement } => {
  const id = `f-${name}`;
  const input = h("input", {
    id,
    name,
    type: "text",
    value,
    autocomplete: "off",
    "aria-describedby": help === undefined ? null : `${id}-help`,
  });
  return {
    input,
    box: h(
      "div",
      { class: "fld" },
      h("label", { for: id }, label),
      input,
      help === undefined ? null : h("p", { class: "fhelp", id: `${id}-help` }, help),
    ),
  };
};

/** A link to the element of `id` where the store has it, else its IDs as text. */
const elementLink = (
  id: string | undefined,
  fallback: {
    readonly identifier?: string | undefined;
    readonly shortId?: string | undefined;
    readonly title?: string | undefined;
  },
  from: string,
): Child => {
  const e = el(id);
  const label = [e?.identifier ?? fallback.identifier, e?.title ?? fallback.title]
    .filter((x) => x !== undefined)
    .join(" ");
  if (e === undefined) {
    return label === "" ? (fallback.shortId ?? null) : label;
  }
  return h("a", { href: withFrom(hashOf("e", refOf(e)), AREA, from) }, label === "" ? e.shortId : label);
};

// ---------------------------------------------------------------------------------------------------------------
// Problems: what workspace.check finds, read once per load of the store

let checked: { readonly epoch: number; readonly out: OutputOf<"workspace.check"> } | undefined;
let checking: { readonly epoch: number; readonly out: Promise<OutputOf<"workspace.check">> } | undefined;

async function check(): Promise<OutputOf<"workspace.check"> | undefined> {
  if (!isOpen()) {
    return undefined;
  }
  if (checked?.epoch === store.epoch) {
    return checked.out;
  }
  const epoch = store.epoch;
  if (checking?.epoch !== epoch) {
    const out = call("workspace.check", { severity: "info" });
    checking = { epoch, out };
    // A failed check is asked again on the next page, not reused.
    out.catch(() => {
      if (checking?.out === out) {
        checking = undefined;
      }
    });
  }
  const out = await checking.out;
  if (epoch === store.epoch) {
    checked = { epoch, out };
  }
  return out;
}

const problemsNow = (): readonly Problem[] => (checked?.epoch === store.epoch ? checked.out.problems : []);
const brokenCount = (): number => problemsNow().filter((p) => p.severity !== "info").length;

addQueue({
  key: "problems",
  title: () => "Errors to fix",
  sub: () => "Elements ReqSeq reports an error for. The page Problems lists every problem of the workspace.",
  warn: true,
  groups: () => {
    const by = new Map<string, Problem[]>();
    for (const p of problemsNow()) {
      if (p.severity === "error" && p.elementId !== undefined) {
        by.set(p.elementId, [...(by.get(p.elementId) ?? []), p]);
      }
    }
    const rows: QueueRow[] = [...by].map(([id, problems]) => {
      const first = problems[0];
      return {
        id,
        ...(first?.elementShortId === undefined
          ? {}
          : {
              fallback: {
                shortId: first.elementShortId,
                ...(first.elementIdentifier === undefined ? {} : { identifier: first.elementIdentifier }),
                ...(first.elementTitle === undefined ? {} : { title: first.elementTitle }),
              },
            }),
        meta: problems.map((p) => p.message).join("; "),
      };
    });
    return [{ title: null, rows }];
  },
});

const SEVERITIES: readonly { readonly key: Problem["severity"]; readonly title: string }[] = [
  { key: "error", title: "Errors" },
  { key: "warning", title: "Warnings" },
  { key: "info", title: "Notes" },
];
/** Rows a group shows at most; the rest is counted. */
const SHOWN = 500;

const where = (p: Problem): string =>
  [
    p.repository,
    p.file === undefined ? undefined : p.line === undefined ? p.file : `${p.file}:${String(p.line)}`,
  ]
    .filter((x) => x !== undefined)
    .join(" · ");

function problemsPage(out: OutputOf<"workspace.check">): HTMLElement {
  const groups = SEVERITIES.map((s) => ({
    ...s,
    rows: out.problems.filter((p) => p.severity === s.key),
  })).filter((g) => g.rows.length > 0);
  return page(
    "w-problems",
    "Problems",
    "What ReqSeq finds when it checks the workspace: errors, warnings and notes.",
    result(out.answer),
    groups.length === 0 ? h("div", { class: "empty" }, h("strong", null, "ReqSeq finds no problem.")) : null,
    groups.map((g) => [
      h("h2", { class: "group" }, g.title, h("b", null, g.rows.length)),
      h(
        "ul",
        { class: "plist", "data-severity": g.key },
        g.rows
          .slice(0, SHOWN)
          .map((p) =>
            h(
              "li",
              null,
              h("span", { class: "pm" }, p.message),
              p.elementId === undefined
                ? null
                : h(
                    "span",
                    { class: "pe" },
                    elementLink(
                      p.elementId,
                      { identifier: p.elementIdentifier, shortId: p.elementShortId, title: p.elementTitle },
                      "problems",
                    ),
                  ),
              where(p) === "" ? null : h("span", { class: "pw" }, where(p)),
            ),
          ),
      ),
      g.rows.length > SHOWN
        ? h(
            "p",
            { class: "more" },
            `${String(g.rows.length - SHOWN)} more ${g.title.toLowerCase()} not shown.`,
          )
        : null,
    ]),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Workspaces: open, switch and create

/** Opens the workspace at `root`, reads it and lets the page draw its overview. */
async function openAt(root: string): Promise<null> {
  let opened;
  try {
    opened = await openWorkspace(root);
  } catch (error) {
    if (error instanceof ReqSeqError && error.code === "workspace.not-found") {
      throw new ReqSeqError(
        error.status,
        { code: "ui.no-workspace-here", message: error.message, details: { path: root } },
        "open",
      );
    }
    throw error;
  }
  showNotMarked(opened.notMarked, opened.generation);
  await load();
  window.dispatchEvent(new Event(WORKSPACE_OPENED));
  return null;
}

async function workspacesPage(route: Route): Promise<HTMLElement | undefined> {
  const [recent, info] = await Promise.all([
    call("workspace.recent").catch(() => undefined),
    isOpen() ? call("tool.info") : Promise.resolve(undefined),
  ]);
  if (!isCurrent(route)) {
    return undefined;
  }
  const out = h("div", { "aria-live": "polite" });
  const recentList =
    recent === undefined || recent.workspaces.length === 0
      ? h("p", { class: "note" }, "No workspace was opened yet.")
      : h(
          "ul",
          { class: "recent" },
          recent.workspaces.map((w) => {
            const current = info?.workspace.path === w.root;
            const open = button(current ? "Open now" : "Open", false);
            open.disabled = !w.exists || current;
            const row = h(
              "li",
              null,
              h(
                "span",
                { class: "rw" },
                path(w.root),
                h(
                  "span",
                  { class: "rd" },
                  w.exists ? `Opened ${new Date(w.opened).toLocaleString()}` : "Not found at this place",
                ),
              ),
              open,
            );
            onPress(open, out, () => openAt(w.root));
            return row;
          }),
        );
  const openField = pathField({
    label: "Folder of the workspace",
    name: "open-path",
    kind: "folder",
    absolute: true,
    help: "The full path of the folder that holds reqseq-workspace.yaml. ~ stands for your home folder.",
  });
  const openButton = button("Open");
  onPress(openButton, out, async () => openAt(await absoluteFolder(openField.input.value)));

  const newField = pathField({
    label: "Folder",
    name: "init-path",
    kind: "folder",
    absolute: true,
    help: "The full path of a new folder, or of one without a workspace yet. It is created when it is missing.",
  });
  const nameField = textField("Name", "init-name");
  const skill = h("input", { type: "checkbox", id: "init-skill", checked: true });
  const createButton = button("Create and open");
  onPress(createButton, out, async () => {
    const folder = await absoluteFolder(newField.input.value);
    const created = await call("workspace.init", {
      path: folder,
      name: nameField.input.value.trim(),
      skill: skill.checked,
    });
    announce(created.answer);
    await openAt(folder);
    return null;
  });

  return page(
    "w-open",
    "Workspaces",
    isOpen() && info !== undefined
      ? `Open now: ${info.workspace.name}`
      : "No workspace is open. Open or create one.",
    isOpen() && info !== undefined ? h("p", null, path(info.workspace.path)) : null,
    out,
    card("Recently opened", recentList),
    card("Open a workspace", h("div", { class: "frow" }, openField.box, openButton)),
    card(
      "Create a workspace",
      newField.box,
      nameField.box,
      h(
        "div",
        { class: "fld check" },
        skill,
        h("label", { for: "init-skill" }, "Write the skill file for AI agents"),
      ),
      createButton,
    ),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Export: into a folder inside the repositories of the workspace (ADR-0020, Front end)

/** Where exports go by default: `exports/` in the main repository, the folder with the workspace file. */
const EXPORTS = "exports";

const fileName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "workspace";

function exportPage(): HTMLElement {
  const html = pathField({
    label: "Folder",
    name: "html-out",
    kind: "folder",
    value: `${EXPORTS}/html`,
    help: "A new or empty folder, or one of an earlier HTML export. Missing folders above it are created.",
  });
  const htmlButton = button("Export HTML");
  const htmlOut = h("div", { "aria-live": "polite" });
  onPress(htmlButton, htmlOut, async () => {
    const out = await call("html.export", { output: html.input.value.trim() });
    return result(
      out.answer,
      h("p", null, "Written to ", path(out.folder)),
      !out.incomplete
        ? null
        : h("p", null, "A repository of the workspace is not on this machine, so its elements are missing."),
      problemList(out.problems),
    );
  });

  const reqif = pathField({
    label: "File",
    name: "reqif-out",
    value: `${EXPORTS}/${fileName(store.workspaceName)}.reqif`,
    kind: "target",
    help: "Missing folders above the file are created.",
  });
  const reqifButton = button("Export ReqIF");
  const reqifOut = h("div", { "aria-live": "polite" });
  onPress(reqifButton, reqifOut, async () => {
    const out = await call("reqif.export", { output: reqif.input.value.trim() });
    return result(out.answer, h("p", null, "Written to ", path(out.file)), problemList(out.problems));
  });

  const json = pathField({
    label: "Folder",
    name: "json-out",
    kind: "folder",
    value: `${EXPORTS}/json`,
  });
  const jsonButton = button("Export JSON");
  const jsonOut = h("div", { "aria-live": "polite" });
  onPress(jsonButton, jsonOut, async () => {
    const out = await call("data.store", { folder: json.input.value.trim() });
    return result(
      out.answer,
      h(
        "p",
        null,
        "Written to ",
        out.files.map((f, at) => [at === 0 ? null : ", ", path(f)]),
      ),
      problemList(out.problems),
    );
  });

  return page(
    "w-export",
    "Export",
    "Every element of the workspace, into a folder inside its repositories. A path is relative to the folder of the workspace.",
    card(
      "HTML pages",
      h("p", { class: "note" }, "Pages to read in any browser, without ReqSeq."),
      h("div", { class: "frow" }, html.box, htmlButton),
      htmlOut,
    ),
    card(
      "ReqIF",
      h("p", { class: "note" }, "A file for other requirements tools."),
      h("div", { class: "frow" }, reqif.box, reqifButton),
      reqifOut,
    ),
    card(
      "JSON",
      h("p", { class: "note" }, "The elements with their relations and verification, for other programs."),
      h("div", { class: "frow" }, json.box, jsonButton),
      jsonOut,
    ),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// ReqIF import: check the file first, then import it

type Analysis = OutputOf<"reqif.analyze">;
type Ref = Analysis["new"][number];

const UNMAPPED: Readonly<Record<Analysis["unmapped"][number]["kind"], string>> = {
  type: "Type",
  attribute: "Attribute",
  relation: "Relation type",
  value: "Value",
};

const refList = (title: string, refs: readonly Ref[]): Child =>
  refs.length === 0
    ? null
    : h(
        "details",
        { class: "refs" },
        h("summary", null, `${title}: ${String(refs.length)}`),
        h(
          "ul",
          null,
          refs
            .slice(0, SHOWN)
            .map((r) =>
              h(
                "li",
                null,
                r.identifier,
                r.id === undefined ? null : [" · ", elementLink(r.id, {}, "import")],
              ),
            ),
        ),
      );

/** The mapping this page saved last, for the ReqIF file it was built for. */
interface Built {
  readonly file: string;
  readonly path: string;
  readonly mapping: Mapping;
  /** The parts the choices were offered for: offered again when ReqSeq refuses the saved mapping. */
  readonly unmapped: Analysis["unmapped"];
}

/** The name of a file without folder and extension: the first guess for the name of its source. */
const stem = (file: string): string => (file.split(/[\\/]/).pop() ?? file).replace(/\.[^.]*$/, "");

function importPage(): HTMLElement {
  const file = pathField({ label: "ReqIF file", name: "reqif-in", kind: "file" });
  const mapping = pathField({
    label: "Mapping file",
    name: "reqif-map",
    kind: "file",
    help: "Needed for a file of another tool: it maps its types and attributes to the metamodel. Leave it empty for a file of ReqSeq, or to choose the mapping on this page.",
  });
  const checkButton = button("Check file");
  const out = h("div", { "aria-live": "polite" });
  const plan = h("div");
  let built: Built | undefined;

  const inputOf = (): { file: string; mapping?: string } => {
    const m = mapping.input.value.trim();
    return { file: file.input.value.trim(), ...(m === "" ? {} : { mapping: m }) };
  };

  /** Checks the file and draws what the import would do, with the choices of the mapping where it lacks some. */
  const check = async (): Promise<Analysis> => {
    plan.replaceChildren();
    const input = inputOf();
    // The page holds the whole mapping only when it built it, and saving replaces the whole file.
    const own =
      input.mapping === undefined
        ? undefined
        : built?.file === input.file && built.path === input.mapping
          ? built
          : null;
    let analysis: Analysis;
    try {
      analysis = await call("reqif.analyze", input);
    } catch (error) {
      // A mapping this page saved that ReqSeq refuses: its choices again, to change the refused one.
      if (own !== undefined && own !== null) {
        plan.replaceChildren(mappingCard(input.file, own.unmapped, own));
      }
      throw error;
    }
    const form = importForm(input, analysis, own !== null);
    plan.replaceChildren(
      ...(own === null || analysis.unmapped.length === 0
        ? [form]
        : [mappingCard(input.file, analysis.unmapped, own), form]),
    );
    return analysis;
  };

  /** The choices of the mapping for the `unmapped` parts of the file, and saving them. */
  const mappingCard = (
    reqif: string,
    unmapped: Analysis["unmapped"],
    own: Built | undefined,
  ): HTMLElement => {
    const source = textField(
      "Name of the source",
      "reqif-source",
      own?.mapping.source.name ?? stem(reqif),
      "The tool or project the file comes from. Each imported element keeps it as its source.",
    );
    const { fields, choices } = mappingFields(store.mm, unmapped, own?.mapping);
    const saveButton = button("Save mapping");
    onPress(saveButton, out, async () => {
      const name = source.input.value.trim();
      const next = withChoices(own?.mapping ?? emptyMapping(name), name, choices());
      const saved = await call("reqif.saveMapping", { mapping: next });
      const written = saved.files[0] ?? own?.path;
      if (written === undefined) {
        return result(saved.answer, problemList(saved.problems));
      }
      built = { file: reqif, path: written, mapping: next, unmapped };
      mapping.input.value = written;
      const again = await check();
      return result(saved.answer, h("p", null, again.answer), problemList(saved.problems));
    });
    return card(
      "Map the file",
      h(
        "p",
        { class: "note" },
        "Choose for each part of the file what it becomes in this workspace, or leave it out; a part without a choice stays unmapped. Saving writes the mapping into the mapping folder of the workspace and checks the file again with it.",
      ),
      h(
        "p",
        { class: "note" },
        "A mapping file of the same source in that folder is replaced as a whole. To keep one, give it as the mapping file instead.",
      ),
      source.box,
      fields,
      saveButton,
    );
  };

  onPress(checkButton, out, async () => result((await check()).answer));

  return page(
    "w-import",
    "Import ReqIF",
    "Check what a ReqIF file would change, then import it. The file lies inside the repositories of the workspace; a path is relative to the folder of the workspace.",
    card("File", file.box, mapping.box, checkButton),
    out,
    plan,
  );
}

function importForm(
  input: { readonly file: string; readonly mapping?: string },
  a: Analysis,
  chosenHere: boolean,
): HTMLElement {
  const choices = a.conflicts.map((c, at) => {
    const name = `conflict-${String(at)}`;
    const take = h("input", { type: "radio", name, value: "take", id: `${name}-take` });
    const keep = h("input", { type: "radio", name, value: "keep", id: `${name}-keep`, checked: true });
    return {
      conflict: c,
      take,
      row: h(
        "li",
        null,
        h(
          "span",
          { class: "pm" },
          c.identifier,
          c.id === undefined ? null : [" · ", elementLink(c.id, {}, "import")],
        ),
        h("span", { class: "radio" }, take, h("label", { for: `${name}-take` }, "Take the delivery")),
        h("span", { class: "radio" }, keep, h("label", { for: `${name}-keep` }, "Keep mine")),
      ),
    };
  });
  const delivery = textField(
    "Name of the delivery",
    "reqif-delivery",
    "",
    "Written to each element the import creates or updates, such as the date or version of the file.",
  );
  const importButton = button("Import");
  const out = h("div", { "aria-live": "polite" });
  delivery.input.required = true;
  onPress(importButton, out, async () => {
    if (delivery.input.value.trim() === "") {
      throw new ReqSeqError(
        0,
        { code: "ui.delivery-missing", message: "No name of the delivery" },
        "reqif.import",
      );
    }
    const take = choices.filter((c) => c.take.checked).map((c) => c.conflict.identifier);
    const keep = choices.filter((c) => !c.take.checked).map((c) => c.conflict.identifier);
    const done = await call("reqif.import", {
      ...input,
      delivery: delivery.input.value.trim(),
      ...(take.length === 0 ? {} : { take }),
      ...(keep.length === 0 ? {} : { keep }),
    });
    return result(
      done.answer,
      done.files.length === 0
        ? null
        : h(
            "details",
            { class: "refs" },
            h("summary", null, `Files written: ${String(done.files.length)}`),
            h(
              "ul",
              null,
              done.files.slice(0, SHOWN).map((f) => h("li", null, path(f))),
            ),
          ),
      done.losses.length === 0
        ? null
        : h("p", null, `${String(done.losses.length)} parts of the file were not taken over without loss.`),
      problemList(done.problems),
    );
  });
  const nothing = a.new.length + a.changed.length === 0;
  return card(
    "What the import would do",
    h(
      "dl",
      { class: "facts-list" },
      [
        ["New elements", a.new.length],
        ["Changed elements", a.changed.length],
        ["Changed on both sides", a.conflicts.length],
        ["No longer in the file", a.dropped.length],
        ["Not mapped", a.unmapped.length],
        ["Not taken over without loss", a.losses.length],
      ].map(([k, v]) => [h("dt", null, String(k)), h("dd", { class: "num" }, String(v))]),
    ),
    refList("New", a.new),
    refList("Changed", a.changed),
    refList("No longer in the file (left as they are)", a.dropped),
    a.unmapped.length === 0
      ? null
      : h(
          "details",
          { class: "refs" },
          h("summary", null, `Not mapped: ${String(a.unmapped.length)}`),
          h(
            "p",
            { class: "note" },
            chosenHere
              ? "The mapping neither maps nor leaves out these, so the import does not take them. Choose them above."
              : "The mapping file neither maps nor leaves out these, so the import does not take them. Map them in that file: this page chooses only for a mapping it builds itself.",
          ),
          h(
            "ul",
            null,
            a.unmapped
              .slice(0, SHOWN)
              .map((u) =>
                h(
                  "li",
                  null,
                  `${UNMAPPED[u.kind]}: ${u.source}`,
                  u.sourceType === undefined ? null : ` (${u.sourceType})`,
                ),
              ),
          ),
        ),
    a.losses.length === 0
      ? null
      : h(
          "details",
          { class: "refs" },
          h("summary", null, `Not taken over without loss: ${String(a.losses.length)}`),
          h(
            "ul",
            null,
            a.losses.slice(0, SHOWN).map((l) => h("li", null, l.identifier, " · ", l.reason)),
          ),
        ),
    problemList(a.problems),
    choices.length === 0
      ? null
      : [
          h("h3", null, "Changed on both sides"),
          h(
            "p",
            { class: "note" },
            "These changed in the delivery and here since the last import. Choose for each.",
          ),
          h(
            "ul",
            { class: "plist" },
            choices.map((c) => c.row),
          ),
        ],
    nothing && choices.length === 0
      ? h("p", { class: "note" }, "The import would create and change nothing.")
      : null,
    delivery.box,
    importButton,
    out,
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Settings: the workspace, its metamodel (read only), AI agents, the theme and the version

const table = (headers: readonly string[], rows: readonly (readonly Child[])[]): HTMLElement =>
  h(
    "div",
    { class: "tscroll" },
    h(
      "table",
      { class: "wtable" },
      h(
        "thead",
        null,
        h(
          "tr",
          null,
          headers.map((x) => h("th", { scope: "col" }, x)),
        ),
      ),
      h(
        "tbody",
        null,
        rows.map((r) =>
          h(
            "tr",
            null,
            r.map((c) => h("td", null, c)),
          ),
        ),
      ),
    ),
  );

const names = (keys: readonly string[] | undefined, name: (key: string) => string): string =>
  (keys ?? []).map(name).join(", ");

function metamodelCard(mermaid: OutputOf<"metamodel.mermaid"> | undefined): HTMLElement {
  const mm = store.mm;
  const prop = (key: string): string => mm.properties.find((p) => p.key === key)?.name ?? key;
  return card(
    "Metamodel",
    h(
      "p",
      { class: "note" },
      "The types, properties, relations and statuses of this workspace. They are read only here.",
    ),
    h("h3", null, "Types"),
    table(
      ["Type", "Prefix", "Properties", "Statuses"],
      mm.types
        .filter((t) => !t.abstract)
        .map((t) => [
          t.name,
          t.prefix,
          names(t.properties, prop),
          names(t.statuses, (s) => statusName(mm, s)),
        ]),
    ),
    h("h3", null, "Properties"),
    table(
      ["Property", "Kind", "Description"],
      mm.properties.map((p) => [p.name, p.many === true ? `${p.kind}, many` : p.kind, p.description ?? ""]),
    ),
    h("h3", null, "Relations"),
    table(
      ["Relation", "From", "To"],
      mm.relations.map((r) => [
        relKind(mm, r.key)?.name ?? r.key,
        names(r["source-types"], (t) => typeName(mm, t)) || "Any type",
        names(r["target-types"], (t) => typeName(mm, t)) || "Any type",
      ]),
    ),
    h("h3", null, "Statuses"),
    table(
      ["Status", "Role", "Description"],
      mm.statuses.map((s) => [
        s.name,
        s.initial === true ? "New elements get it" : s.invalid === true ? "No longer valid" : "",
        s.description ?? "",
      ]),
    ),
    mermaid === undefined
      ? null
      : h(
          "details",
          { class: "refs" },
          h("summary", null, "Diagram source (Mermaid)"),
          h("pre", { class: "wpre" }, mermaid.mermaid),
        ),
  );
}

function agentsCard(
  agents: OutputOf<"workspace.agents"> | undefined,
  clients: OutputOf<"workspace.connectAgent"> | undefined,
): HTMLElement {
  const choices = clients?.clients ?? [];
  const select = h(
    "select",
    { id: "agent-client" },
    choices.map((c) => h("option", { value: c.value }, c.title)),
  );
  const show = button("Show setup", false);
  show.disabled = choices.length === 0;
  const out = h("div", { "aria-live": "polite" });
  onPress(show, out, async () => {
    const setup = await call("workspace.connectAgent", {
      client: select.value as NonNullable<OutputOf<"workspace.connectAgent">["client"]>,
    });
    const text = setup.setup?.text ?? "";
    const copy = button("Copy", false);
    copy.addEventListener("click", () => {
      void navigator.clipboard.writeText(text).then(
        () => {
          announce("Copied.");
        },
        () => {
          announce("The browser did not allow copying. Select the text and copy it.");
        },
      );
    });
    return h(
      "div",
      { class: "notice wok", role: "status" },
      h("p", null, setup.answer),
      setup.setup?.file === undefined ? null : h("p", null, "Configuration file: ", path(setup.setup.file)),
      h("pre", { class: "wpre", "data-setup": true }, text),
      copy,
      setup.valid === undefined ? null : h("p", { class: "note" }, setup.valid),
      setup.next === undefined ? null : h("p", { class: "note" }, setup.next),
    );
  });
  const connected = agents?.connected ?? [];
  return card(
    "AI agents",
    agents === undefined
      ? null
      : h(
          "p",
          null,
          connected.length > 0
            ? `Connected now: ${connected.map((c) => `${c.client ?? "an agent"} since ${new Date(c.since).toLocaleString()}`).join(", ")}.`
            : agents.last === null
              ? "No agent was connected to this workspace yet."
              : `No agent is connected now. Last connected: ${agents.last.client ?? "an agent"}, ${new Date(agents.last.at).toLocaleString()}.`,
        ),
    h(
      "p",
      { class: "note" },
      "An agent works on this workspace through ReqSeq's MCP server. Choose its program to see how to connect it.",
    ),
    h(
      "div",
      { class: "frow" },
      h("div", { class: "fld" }, h("label", { for: "agent-client" }, "Program"), select),
      show,
    ),
    out,
  );
}

function themeCard(): HTMLElement {
  const options: readonly [Theme, string][] = [
    ["system", "As the system"],
    ["light", "Light"],
    ["dark", "Dark"],
  ];
  const chosen = theme();
  return card(
    "Appearance",
    h(
      "fieldset",
      { class: "radios" },
      h("legend", null, "Colours"),
      options.map(([value, label]) => {
        const input = h("input", {
          type: "radio",
          name: "theme",
          id: `theme-${value}`,
          value,
          checked: chosen === value,
        });
        input.addEventListener("change", () => {
          if (input.checked) {
            setTheme(value);
          }
        });
        return h("span", { class: "radio" }, input, h("label", { for: `theme-${value}` }, label));
      }),
    ),
    h("p", { class: "note" }, "Kept in this browser."),
  );
}

function versionCard(info: OutputOf<"tool.info">): HTMLElement {
  const build =
    info.build.development === true || info.build.commit === undefined
      ? "Built from a checkout"
      : `Commit ${info.build.commit}${info.build.date === undefined ? "" : `, ${new Date(info.build.date).toLocaleDateString()}`}`;
  return card(
    "Version",
    h(
      "dl",
      { class: "facts-list" },
      h("dt", null, "Command line"),
      h("dd", null, info.versions.cli),
      h("dt", null, "MCP server"),
      h("dd", null, info.versions.mcp),
      h("dt", null, "Build"),
      h("dd", null, build),
      h("dt", null, "System"),
      h("dd", null, `${info.build.platform} ${info.build.arch}, Node ${info.runtime.node}`),
      h("dt", null, "Documentation"),
      h("dd", null, path(info.documentation.online)),
      h("dt", null, "Releases"),
      h("dd", null, path(info.documentation.releases)),
    ),
    h(
      "div",
      { class: "licence" },
      info.license.notice.map((line) => h("p", null, line)),
    ),
  );
}

async function settingsPage(route: Route): Promise<HTMLElement | undefined> {
  const [status, info, mermaid, agents, clients] = await Promise.all([
    call("workspace.status"),
    call("tool.info"),
    call("metamodel.mermaid").catch(() => undefined),
    call("workspace.agents").catch(() => undefined),
    call("workspace.connectAgent").catch(() => undefined),
  ]);
  if (!isCurrent(route)) {
    return undefined;
  }
  return page(
    "w-settings",
    "Settings",
    "The workspace, its metamodel, AI agents, the appearance and the version of ReqSeq.",
    card(
      "Workspace",
      h(
        "dl",
        { class: "facts-list" },
        h("dt", null, "Name"),
        h("dd", null, status.name),
        h("dt", null, "Folder"),
        h("dd", null, path(info.workspace.path)),
        h("dt", null, "Metamodel"),
        h(
          "dd",
          null,
          `${status.metamodel.repository}: `,
          path(status.metamodel.path),
          status.metamodel.valid ? null : " (faulty)",
        ),
        h("dt", null, "Elements"),
        h("dd", { class: "num" }, String(info.workspace.elements)),
      ),
      status.readOnly
        ? h(
            "p",
            { class: "notice bad" },
            "The workspace opens read only: its metamodel is missing or faulty.",
          )
        : null,
      h("h3", null, "Repositories"),
      table(
        ["Repository", "Place", "State"],
        status.repositories.map((r) => [
          r.name,
          r.absolutePath === undefined ? (r.path === undefined ? "" : path(r.path)) : path(r.absolutePath),
          !r.available ? "Not on this machine" : r.readOnly === true ? "Read only" : "Available",
        ]),
      ),
      status.evidence.length === 0
        ? null
        : [
            h("h3", null, "Evidence"),
            table(
              ["Repository", "Folder", "State"],
              status.evidence.map((e) => [
                e.repository,
                path(e.folder ?? e.path),
                e.available ? "Read" : "Not read",
              ]),
            ),
          ],
      problemList(status.problems),
    ),
    metamodelCard(mermaid),
    agentsCard(agents, clients),
    themeCard(),
    versionCard(info),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Routes and rail

const PAGES: Readonly<
  Record<
    string,
    {
      readonly title: string;
      readonly draw: (route: Route) => Promise<HTMLElement | undefined>;
      /** A page with forms and their answers: a change of the workspace does not draw it again. */
      readonly form?: boolean;
    }
  >
> = {
  open: { title: "Workspaces", draw: workspacesPage, form: true },
  problems: {
    title: "Problems",
    draw: async (route) => {
      const out = await check();
      return out === undefined || !isCurrent(route) ? undefined : problemsPage(out);
    },
  },
  export: { title: "Export", draw: () => Promise.resolve(exportPage()), form: true },
  import: { title: "Import ReqIF", draw: () => Promise.resolve(importPage()), form: true },
  settings: { title: "Settings", draw: settingsPage, form: true },
};

async function render(root: HTMLElement, route: Route): Promise<void> {
  const key = route.parts[1] ?? "";
  const shown = PAGES[key];
  if (shown === undefined) {
    location.replace(`#${WORKSPACES}`);
    return;
  }
  // Drawn again after a change of the same workspace (an import writes elements, so does anyone else): a form page
  // keeps what was typed and answered. Another workspace, or a page that was left, draws it anew.
  const kept = root.querySelector<HTMLElement>(".wpage[data-ws]");
  if (
    shown.form === true &&
    root.dataset["route"] === route.hash &&
    kept !== null &&
    kept.dataset["ws"] === store.workspaceName &&
    (kept.closest(".app") !== null) === isOpen()
  ) {
    return;
  }
  if (isOpen()) {
    await prepareRail();
  }
  const drawn = await shown.draw(route);
  if (drawn === undefined || !isCurrent(route)) {
    return;
  }
  root.replaceChildren(drawn);
  document.title = `${shown.title} · ReqSeq`;
}

addRoute(AREA, render);

/** How long the rail waits for the check, in milliseconds. */
const RAIL_WAIT = 1500;

/** Writes the count of problems into the rail drawn already, when the check answered after it was drawn. */
function showCount(): void {
  const link = document.querySelector<HTMLAnchorElement>(`.rail a[href="${hashOf(AREA, "problems")}"]`);
  if (link === null || checked?.epoch !== store.epoch) {
    return;
  }
  const count = brokenCount();
  let b = link.querySelector("b");
  if (b === null) {
    b = h("b", { "data-num": "q:w-problems" });
    link.append(b);
  }
  b.textContent = String(count);
  link.classList.toggle("warn", count > 0 && problemsNow().some((p) => p.severity === "error"));
}

addRailSection({
  order: 90,
  title: "Workspace",
  // The rail waits for the check a short time only, so a large workspace does not hold every page: a later answer
  // fills in the count. A failed check leaves the count out, never the page.
  prepare: async () => {
    const running = check().then(
      () => {
        showCount();
      },
      () => undefined,
    );
    await Promise.race([running, new Promise((resolve) => setTimeout(resolve, RAIL_WAIT))]);
  },
  links: () => [
    {
      href: hashOf(AREA, "problems"),
      key: "w-problems",
      name: "Problems",
      ...(checked?.epoch === store.epoch ? { count: brokenCount() } : {}),
      warn: problemsNow().some((p) => p.severity === "error"),
    },
    { href: hashOf(AREA, "export"), key: "w-export", name: "Export" },
    { href: hashOf(AREA, "import"), key: "w-import", name: "Import ReqIF" },
    { href: hashOf(AREA, "open"), key: "w-open", name: "Workspaces" },
    { href: hashOf(AREA, "settings"), key: "w-settings", name: "Settings" },
  ],
});
