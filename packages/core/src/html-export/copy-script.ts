// The copy buttons of the HTML export (SR-232 AK1, AK2): a button next to a value that puts the value into the
// clipboard, and the script that does it, `assets/copy.js` (a classic script, as `page-script.ts` says why). Each
// button carries its value in `data-copy` and is written `hidden`: a browser without scripts shows no button that does
// nothing. The script shows the buttons and, on a click, writes the value with the Clipboard API; where that is missing
// or refused (a `file://` page in some browsers), it selects the text of the value (`.rq-value`) next to the button,
// so the reader copies it with the keys. A copied value marks its button `rq-copied` for a moment.
import { escapeHtml } from "./markdown.js";

/** The address of the script, relative to the export folder. */
export const COPY_SCRIPT = "assets/copy.js";

const ICON =
  '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

/** A button that copies `value`; `label` names it for screen readers and as its tooltip. */
export const copyButton = (value: string, label: string): string =>
  `<button type="button" class="rq-copy" data-copy="${escapeHtml(value)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" hidden>${ICON}</button>`;

/** The styles of the copy buttons: shown on hover and focus, always on a touch screen. */
export const COPY_CSS = [
  ".rq-copy { opacity: 0; border: 1px solid var(--sl-color-gray-5); background: var(--sl-color-bg); color: var(--sl-color-gray-3); border-radius: 0.25rem; padding: 0.15rem 0.25rem; line-height: 0; cursor: pointer; }",
  ".rq-copyable:hover .rq-copy, .rq-copy:focus-visible, .rq-copy.rq-copied { opacity: 1; }",
  ".rq-copy.rq-copied { color: var(--sl-color-green); border-color: var(--sl-color-green); }",
  "@media (hover: none) { .rq-copy { opacity: 0.6; } }",
];

// Core has no DOM types (its `lib` is ES only), so the script takes what it uses from `globalThis` as these.
interface Button {
  hidden: boolean;
  title: string;
  readonly dataset: Record<string, string | undefined>;
  readonly classList: { add: (name: string) => void; remove: (name: string) => void };
  readonly parentElement: { querySelector: (selector: string) => unknown } | null;
  closest: (selector: string) => Button | null;
}
interface Browser {
  readonly document: {
    querySelectorAll: (selector: string) => Iterable<Button>;
    addEventListener: (type: string, listener: (event: { target: unknown }) => void) => void;
    createRange: () => { selectNodeContents: (node: unknown) => void };
  };
  readonly navigator: { clipboard?: { writeText: (text: string) => Promise<void> } };
  getSelection: () => { removeAllRanges: () => void; addRange: (range: unknown) => void } | null;
  setTimeout: (fn: () => void, ms: number) => unknown;
}

/** `assets/copy.js` (see the file comment); returns the promise of the copy a click started, for tests. */
export function copyScript(): { clicked: () => Promise<void> } {
  const { document, navigator, getSelection, setTimeout } = globalThis as unknown as Browser;
  let last: Promise<void> = Promise.resolve();
  for (const button of document.querySelectorAll("button.rq-copy")) {
    button.hidden = false;
  }
  const select = (button: Button): void => {
    const value = button.parentElement?.querySelector(".rq-value");
    const selection = getSelection();
    if (value === null || value === undefined || selection === null) {
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(value);
    selection.removeAllRanges();
    selection.addRange(range);
  };
  const copied = (button: Button): void => {
    const title = button.title;
    button.classList.add("rq-copied");
    button.title = "Copied";
    setTimeout(() => {
      button.classList.remove("rq-copied");
      button.title = title;
    }, 1200);
  };
  document.addEventListener("click", (event) => {
    const target = event.target as { closest?: Button["closest"] } | null;
    const button = typeof target?.closest === "function" ? target.closest("button.rq-copy") : null;
    if (button === null) {
      return;
    }
    const clipboard = navigator.clipboard;
    if (clipboard === undefined) {
      select(button);
      return;
    }
    last = clipboard.writeText(String(button.dataset["copy"])).then(
      () => {
        copied(button);
      },
      () => {
        select(button);
      },
    );
  });
  return { clicked: () => last };
}
