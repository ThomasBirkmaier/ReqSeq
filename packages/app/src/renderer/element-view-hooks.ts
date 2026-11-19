// The hooks and helpers of the element buffer (`ElementView.tsx`) that hold none of its input: the dates of its
// outdated hints, its lines read again, its undo memory and area, the image preview and the plugins of its text.
// `ElementView` calls each hook where its code stood, so the order of its hooks and effects stays.
import { Prec } from "@codemirror/state";
import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DataExportElement, ElementGetOutput } from "@reqseq/core";
import type { BufferKeep, UndoMemory } from "./buffer-memory.js";
import type { ElementBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import type { ElementLoad } from "./element-view.js";
import { undatedHints, withHintDates } from "./element-view.js";
import type { ElementNow } from "./element-input.js";
import { formulasAndDiagrams } from "./editor/formulas-diagrams.js";
import type { ImageElement } from "./editor/image-preview.js";
import { imagePreview } from "./editor/image-preview.js";
import type { EditorPlugins } from "./editor/plugins.js";
import { mergePlugins } from "./editor/plugins.js";
import { findMarks } from "./editor/find.js";
import { formatKeys } from "./editor/format.js";
import { pasteAsMarkdown } from "./editor/paste.js";
import { tableEditing } from "./editor/tables.js";
import { sectionFolding } from "./editor/folding.js";
import { references } from "./editor/references.js";
import type { OutdatedMark, Reference } from "./editor/references.js";
import { listDrag } from "./editor/list-drag.js";
import { listKeys } from "./editor/lists.js";
import { boxNavigation } from "./editor/box-navigation.js";
import { referenceSearch } from "./editor/reference-search.js";
import { slashMenu } from "./editor/slash-menu.js";
import type { ImageRequest, ReferenceRequest, SlashMenuOptions } from "./editor/slash-menu.js";
import { imagePrompt } from "./insert-image.js";
import type { ReferenceTitles } from "./reference-titles.js";
import { hasStatus } from "./variant-lines.js";

/** Folding of the sections under the headings of the text (SR-191): one extension for every element buffer. */
const SECTION_FOLDING = { extensions: [sectionFolding()] };

/** `value` for a shown view, nothing for one drawn hidden in advance (SR-212 AK5). */
export const shownOnly = <T>(hidden: boolean, value: T): T | undefined => (hidden ? undefined : value);

/** Whether the loaded element is of a type with the meaning `variant`. */
export const isVariantPage = (view: ElementLoad, variantTypes: ReadonlySet<string> | undefined): boolean =>
  view.status === "ok" && variantTypes?.has(view.element.type) === true;

/** The focused target link of a relation box or a relation group of the element buffer, if one has the focus. */
export const focusedTarget = (): HTMLElement | null =>
  document.activeElement instanceof HTMLElement
    ? document.activeElement.closest<HTMLElement>("[data-buffer] [data-target-id]")
    : null;

/**
 * An outdated reference shows the version it stores, as the date of that version (SR-110 AK2, D-013). The
 * element is read without dates, so opening it runs no git (SR-082 AK3); only an element with outdated
 * relations or references is asked for again, for the dates of these hints alone (`hintDates`: Git reads
 * the histories of their targets), and again only when these hints change (ThomasBirkmaier/ReqSeq-archive#702). The answer is the
 * element as the buffer shows it, with the dated hints in place of the undated ones (`withHintDates`).
 */
export const useHintDates = (
  call: Call,
  buffer: ElementBuffer,
  view: ElementLoad,
): ((element: DataExportElement) => DataExportElement) => {
  const undatedKey = view.status === "ok" ? undatedHints(view.element) : "";
  const [datedHints, setDatedHints] = useState<NonNullable<DataExportElement["problems"]>>([]);
  useEffect(() => {
    if (undatedKey === "") {
      return;
    }
    let current = true;
    void call("element.get", { ref: buffer.id, repository: buffer.repository, hintDates: true }).then(
      (answer) => {
        // A failed read leaves the hints without dates; the load of the element reports why.
        if (current && answer.ok) {
          setDatedHints(answer.output.element.problems ?? []);
        }
      },
    );
    return () => {
      current = false;
    };
  }, [call, buffer.id, buffer.repository, undatedKey]);
  return useCallback((element: DataExportElement) => withHintDates(element, datedHints), [datedHints]);
};

/**
 * A change from outside that did not name the element can still change its variant lines (SR-046, SR-047): a
 * variant's exclusions, a replacing requirement, the records. A requirement or need (one with a
 * verification or validation status) is read again for the lines alone on each such change (`elsewhere` counts them), as the parents
 * line is on every change. Only the lines take the answer, so the fields, their highlights and the input
 * stay as they are.
 */
export const useLinesAgain = (
  call: Call,
  buffer: ElementBuffer,
  elsewhere: number,
  got: Pick<ElementGetOutput, "element" | "names" | "criterionReferences"> | undefined,
  setGot: (output: Pick<ElementGetOutput, "element" | "names" | "criterionReferences">) => void,
): void => {
  const asked = got !== undefined && hasStatus(got.element);
  useEffect(() => {
    if (elsewhere === 0 || !asked) {
      return;
    }
    let current = true;
    void call("element.get", { ref: buffer.id, repository: buffer.repository }).then((answer) => {
      // A failed read keeps the lines; the next read of the element says why.
      if (current && answer.ok) {
        setGot(answer.output);
      }
    });
    return () => {
      current = false;
    };
  }, [call, buffer.id, buffer.repository, elsewhere]);
};

/** The undo history of the buffer (SR-105 AK2): the app's, kept with the buffer, or else one of the view's own. */
export const useUndoMemory = (keep: BufferKeep | undefined): UndoMemory => {
  const own = useRef<UndoMemory>({ editors: new Map(), values: new Map() });
  return keep?.memory ?? own.current;
};

/**
 * Whether the view is in the active area (SR-115 AK3; without an area it is), and whether the elements of a
 * package page take the focus when they load: only when the page comes back (`returning`) in the active
 * area. When the other area becomes active the element is left, so its input is saved then (`flush`, SR-105
 * AK1); the view stays mounted, so the save of leaving (`keep.left`) does not run.
 */
export const useArea = (
  inArea: boolean | undefined,
  returning: boolean,
  flush: () => Promise<boolean>,
): { readonly active: boolean; readonly membersFocus: boolean } => {
  const active = inArea !== false;
  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current && !active) {
      void flush();
    }
    wasActive.current = active;
  }, [active]);
  return { active, membersFocus: returning && active };
};

/**
 * The images of the text (SR-184), drawn relative to the element's file in its repository. Made once, so
 * the images that failed to load survive a reconfiguration; the file is read when the preview is built.
 */
const useImagePreview = (view: ElementLoad, repository: string): EditorPlugins => {
  const element = useRef<ImageElement>({ repository, file: "" });
  if (view.status === "ok") {
    element.current = { repository: view.element.repository, file: view.element.file };
  }
  return useMemo(() => imagePreview(() => element.current), []);
};

/** What the plugins of the text take of the render. */
export interface TextPluginParts {
  readonly now: RefObject<ElementNow>;
  readonly view: ElementLoad;
  readonly buffer: ElementBuffer;
  readonly titles: ReferenceTitles;
  readonly outdated: ReadonlyMap<string, OutdatedMark> | undefined;
  readonly signature: string;
  readonly step: (from: string, by: 1 | -1) => boolean;
}

/** The plugins of the text, and what the boxes share with them. */
export interface TextPlugins {
  readonly pick: SlashMenuOptions;
  readonly title: ReferenceTitles["title"];
  readonly follow: (reference: Reference) => void;
  readonly plugins: EditorPlugins;
}

/** The plugins of the text editor, with the slash menu, the `[[` search and the pasting they hold. */
export const useTextPlugins = (parts: TextPluginParts): TextPlugins => {
  const { now, view, buffer, titles, outdated, signature, step } = parts;
  // The slash menu and the `[[` search (SR-066) are created once: they hold state (the `/` typed), which a
  // reconfiguration would keep only for the same extensions.
  const pick = useMemo(
    () => ({
      pickElement: (request: ReferenceRequest) => {
        now.current.onPickElement(request);
      },
      repository: () => now.current.buffer.repository,
      // "Image" (SR-097) and the action "Insert image" ask in the same prompt.
      pickImage: (request: ImageRequest) => {
        const { call: run, buffer: shown, onAsk: ask, onEcho: echo } = now.current;
        ask(imagePrompt(run, shown.id, shown.repository, request, echo));
      },
    }),
    [],
  );
  const images = useImagePreview(view, buffer.repository);
  // Pasted and dropped images (SR-190 AK3) are copied as "Insert image" does, from their bytes.
  const paste = useMemo(
    () =>
      pasteAsMarkdown(() => ({
        attach: async ({ content, name }) => {
          const { call: run, buffer: shown, onEcho: echo } = now.current;
          const answer = await run("element.addAttachment", {
            ref: shown.id,
            repository: shown.repository,
            content,
            name,
          });
          if (answer.ok) {
            return answer.output.markdown;
          }
          echo(answer.message);
          return undefined;
        },
        echo: (message) => {
          now.current.onEcho(message);
        },
      })),
    [],
  );
  const slash = useMemo(() => slashMenu(pick), [pick]);
  const brackets = useMemo(() => referenceSearch(pick), [pick]);
  // The title of the target of a reference to another repository, when it is here (D-058): the preview of
  // the text and of the Markdown boxes shows it in place of the short ID.
  const title = titles.title;
  // Following a reference, in the text and in the boxes. One function, so a box keeps its plugins.
  const follow = useCallback((reference: Reference): void => {
    now.current.onOpenTarget(reference.id, reference.repository);
  }, []);
  const stepRef = useRef(step);
  stepRef.current = step;
  const plugins = useMemo(
    () =>
      mergePlugins(
        references({ outdated: outdated ?? new Map(), follow, title }),
        slash,
        brackets,
        formulasAndDiagrams,
        images,
        tableEditing,
        // Tab, Shift+Tab and Alt+arrows in lists, and dragging items by their marks (SR-187).
        { extensions: [listKeys(), listDrag()] },
        formatKeys(true),
        paste,
        // The marks of "Find in element" (SR-189).
        { extensions: [findMarks] },
        SECTION_FOLDING,
        {
          // After the slash menu, which takes Down while it is open.
          extensions: [
            boxNavigation(
              { down: () => stepRef.current("Text", 1), up: () => stepRef.current("Text", -1) },
              Prec.high,
            ),
          ],
        },
      ),
    [signature, slash, brackets, title, images, paste],
  );
  return { pick, title, follow, plugins };
};
