// Diagnostics for Electron tests of the editor (#573): a log, kept in the page, of what can take the slash
// menu away between the last typed letter and Enter: focus and blur, selection changes, the keys Enter,
// Escape and Tab, and every editor transaction (typing in one short line), each with the completion state
// of the editor at that moment. It is printed to standard output only when a test fails, so it is in the
// job log (the CI artifacts cannot always be fetched). It adds no waits, retries or input; its cost in the
// page is a few microseconds per event.
import type { Page, TestInfo } from "@playwright/test";

/** Starts the log in the window. Call it right after the app started, before the first key. */
export const recordEvents = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    interface Source {
      readonly state: number;
    }
    interface State {
      readonly values: readonly unknown[];
      readonly doc: { toString(): string };
      readonly selection: { readonly main: { readonly head: number } };
    }
    interface Transaction {
      readonly docChanged: boolean;
      readonly selection: { readonly main: { readonly head: number } } | undefined;
      readonly effects: readonly unknown[];
      readonly changes: {
        iterChanges(
          f: (
            fromA: number,
            toA: number,
            fromB: number,
            toB: number,
            inserted: { toString(): string },
          ) => void,
        ): void;
      };
      isUserEvent(event: string): boolean;
    }
    interface View {
      readonly state: State;
      dispatchTransactions: (transactions: readonly Transaction[], view: View) => void;
      __logged?: boolean;
    }
    interface Logged {
      __eventLog?: string[];
      __eventLogSnapshot?: () => string[];
    }
    const target = window as unknown as Logged;
    if (target.__eventLog !== undefined) {
      return;
    }
    const log: string[] = [];
    target.__eventLog = log;
    const at = (): string => performance.now().toFixed(1);
    // `getAttribute`, not `className`: an SVG element's `className` is no string.
    const describe = (node: unknown): string => {
      if (node instanceof Element) {
        const classes = node.getAttribute("class") ?? "";
        const label = node.getAttribute("aria-label");
        return `${node.tagName.toLowerCase()}${classes === "" ? "" : `.${classes.split(" ").join(".")}`}${label === null ? "" : `[${label}]`}`;
      }
      return node === window ? "window" : node === document ? "document" : String(node);
    };
    const push = (line: string): void => {
      log.push(`${at()} ${line}`);
      // A bound: a test types a few hundred keys at most.
      if (log.length > 2000) {
        log.shift();
      }
    };
    // The view, as `EditorView.findFromDOM` finds it in @codemirror/view 6.43 (the content element carries
    // its tile). Internal: an upgrade may move it, and the log then says so (`watch`).
    const viewOf = (content: Element | null | undefined): View | undefined =>
      (content as { cmTile?: { root?: { view?: View } } } | null | undefined)?.cmTile?.root?.view;
    // What `completionStatus` of @codemirror/autocomplete 6.20.4 answers: its state has `active` (the
    // sources: 0 inactive, 1 pending, 3 result) and `open` (the shown list). Internal too: "no
    // autocompletion" can also mean that an upgrade changed this shape.
    const status = (state: State): string => {
      const completion = state.values.find(
        (value): value is { active: readonly Source[]; open: unknown } =>
          typeof value === "object" && value !== null && "active" in value && "open" in value,
      );
      if (completion === undefined) {
        return "no-autocompletion";
      }
      return completion.active.some((source) => source.state === 1)
        ? "pending"
        : completion.active.some((source) => source.state !== 0)
          ? completion.open === null
            ? "active-closed"
            : "active-open"
          : "null";
    };
    const focusedStatus = (): string => {
      const view = viewOf(document.activeElement?.closest(".cm-content"));
      return view === undefined ? "no editor focused" : status(view.state);
    };

    for (const type of ["focus", "blur", "focusin", "focusout"]) {
      window.addEventListener(
        type,
        (event) => {
          push(`${type} target=${describe(event.target)} active=${describe(document.activeElement)}`);
        },
        true,
      );
    }
    document.addEventListener("visibilitychange", () => {
      push(`visibilitychange ${document.visibilityState}`);
    });
    document.addEventListener("selectionchange", () => {
      const selection = document.getSelection();
      push(
        `selectionchange anchor=${describe(selection?.anchorNode?.parentElement)}:${String(selection?.anchorOffset)} focus=${String(selection?.focusOffset)}`,
      );
    });
    // The keys that take, close or move in the menu: the state when they arrive (capture), and whether a
    // handler took them (bubble, on the window: after the editor's keymap).
    const KEYS = new Set(["Enter", "Escape", "Tab"]);
    window.addEventListener(
      "keydown",
      (event) => {
        if (KEYS.has(event.key)) {
          push(
            `keydown ${event.key} target=${describe(event.target)} active=${describe(document.activeElement)} completion=${focusedStatus()}`,
          );
        }
      },
      true,
    );
    window.addEventListener("keydown", (event) => {
      if (KEYS.has(event.key)) {
        push(`keydown ${event.key} handled=${String(event.defaultPrevented)} completion=${focusedStatus()}`);
      }
    });

    const EVENTS = [
      "input.complete",
      "input.paste",
      "input.drop",
      "input",
      "select",
      "delete",
      "undo",
      "redo",
      "move",
    ];
    const line = (transaction: Transaction, editor: string, before: string, after: string): string => {
      const head = transaction.selection === undefined ? "-" : String(transaction.selection.main.head);
      if (transaction.isUserEvent("input.type")) {
        const typed: string[] = [];
        transaction.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
          typed.push(inserted.toString());
        });
        return `type ${JSON.stringify(typed.join(""))} head=${head} completion=${before}->${after}`;
      }
      const event = EVENTS.find((name) => transaction.isUserEvent(name)) ?? "none";
      return `transaction editor=${editor} userEvent=${event} docChanged=${String(transaction.docChanged)} head=${head} effects=${String(transaction.effects.length)} completion=${before}->${after}`;
    };
    const unseen = new WeakSet<Element>();
    const watch = (): void => {
      for (const content of document.querySelectorAll(".cm-content")) {
        const view = viewOf(content);
        if (view === undefined) {
          if (!unseen.has(content)) {
            unseen.add(content);
            push(`transactions not recorded: no view on ${describe(content)}`);
          }
          continue;
        }
        if (view.__logged === true) {
          continue;
        }
        view.__logged = true;
        const editor = describe(content);
        const dispatch = view.dispatchTransactions.bind(view);
        view.dispatchTransactions = (transactions, self) => {
          let before = "?";
          try {
            before = status(view.state);
          } catch (error) {
            push(`log error: ${String(error)}`);
          }
          try {
            dispatch(transactions, self);
          } finally {
            // The log never stops a transaction: it is written after it, and its errors are logged.
            try {
              const after = status(view.state);
              for (const transaction of transactions) {
                push(line(transaction, editor, before, after));
              }
            } catch (error) {
              push(`log error: ${String(error)}`);
            }
          }
        };
      }
    };
    watch();
    new MutationObserver((records) => {
      if (records.some((record) => record.addedNodes.length > 0)) {
        watch();
      }
    }).observe(document.body, { childList: true, subtree: true });

    // What the page shows when the test failed: the focus, the menu, and each editor's completion state.
    target.__eventLogSnapshot = () => {
      const lines = [
        `activeElement=${describe(document.activeElement)} hasFocus=${String(document.hasFocus())}`,
        `menu shown=${String(document.querySelector(".cm-tooltip-autocomplete") !== null)}`,
      ];
      for (const content of document.querySelectorAll(".cm-content")) {
        const view = viewOf(content);
        if (view !== undefined) {
          const { state } = view;
          const head = state.selection.main.head;
          const text = state.doc.toString();
          lines.push(
            `editor ${describe(content)}: completion=${status(state)} head=${String(head)} before caret=${JSON.stringify(text.slice(Math.max(0, head - 40), head))}`,
          );
        }
      }
      return lines;
    };
    push(`recording active=${describe(document.activeElement)} hasFocus=${String(document.hasFocus())}`);
  });
};

/** Prints the log and the state of the page to standard output when the test did not pass. */
export const printEventsOnFailure = async (page: Page, testInfo: TestInfo): Promise<void> => {
  if (testInfo.status === testInfo.expectedStatus) {
    return;
  }
  const [log, now] = await Promise.all([
    page
      .evaluate(() => (window as unknown as { __eventLog?: string[] }).__eventLog ?? ["no log"])
      .catch((error: unknown) => [`log not readable: ${String(error)}`]),
    page
      .evaluate(
        () =>
          (window as unknown as { __eventLogSnapshot?: () => string[] }).__eventLogSnapshot?.() ?? [
            "no snapshot",
          ],
      )
      .catch((error: unknown) => [`state not readable: ${String(error)}`]),
  ]);
  process.stdout.write(
    [
      `--- event log of "${testInfo.title}" (#573) ---`,
      ...log,
      "--- page now ---",
      ...now,
      "--- end ---",
      "",
    ].join("\n"),
  );
};
