// The minibuffer: the one control of the window. Idle it is a single line with the last message; asked
// (a prompt) it is an input with the candidates rising above the modeline, not a dialog, only while asked.
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  ArgumentExplanation,
  Choice,
  CommandExplanation,
  CommandHelp,
  Found,
  Prompt,
  PromptFill,
} from "./actions.js";
import { NEXT_BUFFER_SHORTCUT, OTHER_WINDOW_SHORTCUT, PREVIOUS_BUFFER_SHORTCUT } from "./actions.js";
import { highlightRanges, highlightTerms } from "./highlight.js";
import type { Part } from "./highlight.js";
import type { Ranked } from "./fuzzy.js";
import { isMac, listStep, matches, pressLabel, rowStep, shortcutLabel } from "./keys.js";
import {
  COMMAND_HELP_KEY,
  COPY_SHORTCUT,
  HELP_KEY,
  MORE_SHORTCUT,
  NEXT_KEY,
  PREVIOUS_KEY,
  isCommandHelpKey,
} from "./prompt-keys.js";
import { SnippetLine } from "./ListView.js";
import { promptRows } from "./usage.js";
import type { PromptRow } from "./usage.js";

export interface MinibufferProps {
  /** The message shown while idle. */
  readonly echo: string;
  /** The question being asked; `serial` is new for every question, so a new one starts empty. */
  readonly prompt: { readonly serial: number; readonly prompt: Prompt } | undefined;
  /** A click on the idle line, anywhere but on the card of the next keys: ask for a command. */
  readonly onCommand: () => void;
  /** The prompt ends: Escape (`cancelled`, SR-117 keeps a held access for it), or an answer. */
  readonly onClose: (cancelled: boolean) => void;
  /**
   * The possible next keys after the prefix key, with their commands (SR-109 AK3): shown above the idle
   * line, which says the prefix ("Ctrl+K-"); no input, the focus stays where it is.
   */
  readonly nextKeys?:
    readonly { readonly key: string; readonly name: string; readonly selected?: boolean }[] | undefined;
}

const parts = ({ item, ranges }: Ranked<Choice>): Part[] => {
  if (item.marks !== undefined) {
    return highlightRanges(item.name, item.marks);
  }
  return item.terms === undefined
    ? highlightRanges(item.name, ranges)
    : highlightTerms(item.name, item.terms);
};

/** The copy of a card that runs the motion back after the card closed, by the node it was made of. */
const leaving = new WeakMap<HTMLElement, HTMLElement>();

/**
 * How long after a card that stood closed a new card stands at once too: the next argument of a command
 * and the hits of Go to come after a call to core, which can outlast the motion back (ms).
 */
const TAKES_PLACE_MS = 300;

/** When a card that stood still last closed, by the minibuffer it was in (`performance.now()`). */
const closedAt = new WeakMap<HTMLElement, number>();

/**
 * A copy of `node` in `parent` that runs the motion back (SR-182 AK6); it says nothing to a screen reader,
 * is no hit to a test and has no control, and it goes when its animation ends. Without motion it goes at once (AK7).
 */
const leave = (node: HTMLElement, parent: HTMLElement): HTMLElement | undefined => {
  // Whether the card had stood still, or was still on its way in.
  const risen = node.getAnimations().length === 0;
  const copy = node.cloneNode(true) as HTMLElement;
  for (const element of [copy, ...copy.querySelectorAll("*")]) {
    for (const name of ["id", "role", "aria-label", "aria-controls"]) {
      element.removeAttribute(name);
    }
    element.classList.remove("candidates");
  }
  // A control of the card ("help" of the explanation line, SR-210 AK4) is only its look in the copy: no button
  // stays in the window once the prompt closed (SR-100).
  for (const button of copy.querySelectorAll("button")) {
    const look = document.createElement("span");
    look.className = button.className;
    look.append(...button.childNodes);
    button.replaceWith(look);
  }
  copy.classList.add("card-leaving");
  copy.dataset["motion"] = "out";
  copy.dataset["risen"] = String(risen);
  copy.setAttribute("aria-hidden", "true");
  copy.inert = true;
  parent.append(copy);
  // The copy shows the rows the card showed, not its first ones.
  const list = node.querySelector(".card-list");
  const shown = copy.querySelector(".card-list");
  if (list !== null && shown !== null) {
    shown.scrollTop = list.scrollTop;
  }
  const { animationName } = getComputedStyle(copy);
  if (animationName === "" || animationName === "none") {
    copy.remove();
    return undefined;
  }
  const gone = (): void => {
    copy.remove();
  };
  copy.addEventListener("animationend", (event) => {
    if (event.target === copy) {
      gone();
    }
  });
  // Also when no animation ends, such as in a hidden window.
  setTimeout(gone, 1000);
  return copy;
};

/**
 * The card above the minibuffer (SR-182): the hits of a prompt or the next keys (SR-109). When it appears
 * it rises from the command line while the backdrop dims and blurs in a seam as wide as its shadow, all
 * by the same progress (AK1, AK2, AK5); new hits, or a card that comes within `TAKES_PLACE_MS` of one
 * that stood and closed, move nothing (AK4); on close a copy runs the motion back, shorter (AK6). The input keeps the focus
 * throughout (AK3). The times and amounts are the `--card-*` tokens of styles.css; without motion the
 * card stands at once (AK7). The backdrop takes no click: the card stays no dialog (D-062).
 */
const Card = ({ children }: { readonly children: React.ReactNode }): React.JSX.Element => {
  const backdrop = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const own = card.current;
    const nodes = [backdrop.current, own].filter((node) => node !== null);
    const parent = own?.parentElement;
    if (parent === null || parent === undefined) {
      return undefined;
    }
    for (const node of nodes) {
      // Mounted again at once (React's StrictMode): the card never left.
      leaving.get(node)?.remove();
      leaving.delete(node);
    }
    if (own?.dataset["motion"] === undefined) {
      // A card that takes the place of one still leaving (the next argument of a command, Ctrl+Shift+P
      // over Ctrl+P, new hits after a moment without any) stands at once, unless that one was itself
      // still on its way in (Ctrl+P and a key at once).
      const before = [...parent.children].filter(
        (child): child is HTMLElement =>
          child instanceof HTMLElement && child.classList.contains("card-leaving"),
      );
      const recent = performance.now() - (closedAt.get(parent) ?? -Infinity) < TAKES_PLACE_MS;
      const stood = recent || before.some((child) => child.dataset["risen"] === "true");
      for (const child of before) {
        child.remove();
      }
      for (const node of nodes) {
        node.dataset["motion"] = stood ? "still" : "in";
      }
    }
    return () => {
      // A card that stood: a card that comes soon after it takes its place.
      if (own?.getAnimations().length === 0) {
        closedAt.set(parent, performance.now());
      }
      for (const node of nodes) {
        const copy = leave(node, parent);
        if (copy !== undefined) {
          leaving.set(node, copy);
        }
      }
    };
  }, []);
  return (
    <>
      <div className="card-backdrop" aria-hidden="true" ref={backdrop} />
      <div className="card" ref={card}>
        <div className="card-seam" aria-hidden="true" />
        {children}
      </div>
    </>
  );
};

/** Enter as the explanation line names it: "Enter", or "↩" under macOS. */
const enterLabel = (mac: boolean): string => shortcutLabel({ mod: false, shift: false, key: "enter" }, mac);

/**
 * The explanation line (SR-210 AK1, AK2): under the hits, two text lines high whatever it says, so the hits do not
 * move. `text` wraps over both lines (`lines` 2) or stands in the first (`lines` 1, the second is `keys`), cut with
 * "…" where it does not fit; `side` stands at the right of the first line.
 */
const ExplainLine = ({
  text,
  lines,
  side,
  keys,
}: {
  readonly text?: React.ReactNode;
  readonly lines: 1 | 2;
  readonly side?: React.ReactNode;
  readonly keys?: React.ReactNode;
}): React.JSX.Element => (
  <div className="card-explain" id="prompt-explain" role="note" aria-label="Explanation">
    <div className="explain-text" data-lines={lines}>
      {text}
    </div>
    {side === undefined ? null : <div className="explain-side">{side}</div>}
    {keys === undefined ? null : <div className="explain-keys">{keys}</div>}
  </div>
);

/**
 * The explanation line of the marked entry (SR-210 AK1, AK5): the summary of its catalog command, or the
 * description of an action, wrapped over two lines; at the right the number of the optional arguments of a catalog
 * command with Ctrl/Cmd+Enter, which offers them, and "help" with its key: a click on it opens the command help as
 * Ctrl+H does (AK4).
 */
const CommandLine = ({
  explain,
  mac,
  onHelp,
}: {
  readonly explain: CommandExplanation;
  readonly mac: boolean;
  readonly onHelp: (() => void) | undefined;
}): React.JSX.Element => {
  const optional = explain.optional ?? 0;
  return (
    <ExplainLine
      text={explain.summary}
      lines={2}
      side={
        <>
          {optional === 0 ? null : (
            <span className="explain-optional">
              {`${String(optional)} optional`} · <kbd>{shortcutLabel(MORE_SHORTCUT, mac)}</kbd>
              {onHelp === undefined ? null : " · "}
            </span>
          )}
          {onHelp === undefined ? null : (
            <button
              type="button"
              className="explain-help"
              tabIndex={-1}
              // The input keeps the focus, as on a click on a hit.
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={onHelp}
            >
              <kbd>{pressLabel(COMMAND_HELP_KEY, mac)}</kbd> help
            </button>
          )}
        </>
      }
    />
  );
};

/**
 * The explanation line of the argument asked (SR-210 AK2), where the command's stood and as high: in the first
 * line its name and catalog description, in the second the keys of this step with what they do.
 */
const ArgumentLine = ({
  explain,
  back,
  mac,
}: {
  readonly explain: ArgumentExplanation;
  readonly back: boolean;
  readonly mac: boolean;
}): React.JSX.Element => {
  const enter = enterLabel(mac);
  const keys: { readonly key: string; readonly does: string }[] = [
    ...(explain.list ? [{ key: enter, does: "adds a value" }] : []),
    ...(explain.ends ? [{ key: enter, does: "on an empty input ends the values" }] : []),
    ...(explain.skips ? [{ key: enter, does: "on an empty input skips it" }] : []),
    ...(explain.more ? [{ key: shortcutLabel(MORE_SHORTCUT, mac), does: "more arguments" }] : []),
    ...(back ? [{ key: "Escape", does: "back" }] : []),
  ];
  return (
    <ExplainLine
      text={
        <>
          <span className="explain-name">{explain.name}</span>
          {explain.description === undefined ? null : ` · ${explain.description}`}
        </>
      }
      lines={1}
      keys={keys.map(({ key, does }, at) => (
        <Fragment key={does}>
          {at === 0 ? null : " · "}
          <kbd>{key}</kbd> {does}
        </Fragment>
      ))}
    />
  );
};

/**
 * The explanation line (SR-210): of the argument asked, else of the marked entry in a prompt that keeps its place
 * (`explains`, the command prompt), empty for an entry without one (AK5: an element, a buffer) and without hits.
 * Other prompts have none.
 */
const explanationOf = (
  prompt: Prompt,
  marked: Choice | undefined,
  mac: boolean,
  onHelp: () => void,
): { readonly line: React.JSX.Element | null; readonly said: boolean } => {
  if (prompt.explain !== undefined) {
    return {
      line: <ArgumentLine explain={prompt.explain} back={prompt.back !== undefined} mac={mac} />,
      said: true,
    };
  }
  if (prompt.explains !== true) {
    return { line: null, said: false };
  }
  const explain = marked?.inert === true ? undefined : marked?.explain;
  return explain === undefined
    ? { line: <ExplainLine lines={2} />, said: false }
    : {
        line: (
          <CommandLine explain={explain} mac={mac} onHelp={marked?.help === undefined ? undefined : onHelp} />
        ),
        said: true,
      };
};

/** The rows of a part of the command help: a term and what it means. */
const HelpRows = ({
  className,
  rows,
}: {
  readonly className: string;
  readonly rows: readonly {
    readonly term: React.ReactNode;
    readonly text?: React.ReactNode;
    readonly key: string;
  }[];
}): React.JSX.Element => (
  <dl className={className}>
    {rows.map(({ term, text, key }) => (
      <Fragment key={key}>
        <dt>{term}</dt>
        {text === undefined ? null : <dd>{text}</dd>}
      </Fragment>
    ))}
  </dl>
);

/**
 * The content of the command help (SR-210 AK3, AK5), as plain text from the catalog: the title, the summary and
 * details of the reference page, each argument with its description and whether it is required, and the call on
 * the command line; for an action of the app its key and the catalog commands it runs by display. At the end the
 * keys of the help and the link that opens the documentation, as F1 does (`onDocs`, absent without documentation).
 */
const HelpContent = ({
  help,
  mac,
  onDocs,
}: {
  readonly help: CommandHelp;
  readonly mac: boolean;
  readonly onDocs: (() => void) | undefined;
}): React.JSX.Element => (
  <>
    <h2 className="help-title">{help.title}</h2>
    <p className="help-summary">{help.summary}</p>
    {help.details === undefined ? null : <p className="help-details">{help.details}</p>}
    {help.key === undefined ? null : (
      <>
        <h3>Key</h3>
        <p className="help-key">
          <kbd>{help.key}</kbd>
        </p>
      </>
    )}
    {help.runs === undefined ? null : (
      <>
        <h3>Catalog commands it runs</h3>
        <HelpRows
          className="help-runs"
          rows={help.runs.map(({ where, command }) => ({
            key: `${where} ${command}`,
            term: <code>{command}</code>,
            text: where,
          }))}
        />
      </>
    )}
    {help.arguments === undefined ? null : (
      <>
        <h3>Arguments</h3>
        {help.arguments.length === 0 ? (
          <p>No arguments.</p>
        ) : (
          <HelpRows
            className="help-arguments"
            rows={help.arguments.map((arg) => ({
              key: arg.name,
              term: (
                <>
                  <code>{arg.name}</code>{" "}
                  <span className="help-need">{arg.required ? "required" : "optional"}</span>
                </>
              ),
              ...(arg.description === undefined ? {} : { text: arg.description }),
            }))}
          />
        )}
      </>
    )}
    {help.cli === undefined ? null : (
      <>
        <h3>Command line</h3>
        <pre className="help-cli">{help.cli}</pre>
      </>
    )}
    <p className="help-keys">
      <kbd>↑</kbd> <kbd>↓</kbd> <kbd>{pressLabel(NEXT_KEY, mac)}</kbd>{" "}
      <kbd>{pressLabel(PREVIOUS_KEY, mac)}</kbd> scroll · <kbd>{pressLabel(COMMAND_HELP_KEY, mac)}</kbd> or{" "}
      <kbd>Escape</kbd> back to the hits
      {onDocs === undefined ? null : (
        <>
          {" · "}
          <kbd>{HELP_KEY}</kbd>{" "}
          <a
            href="#"
            className="help-docs"
            // The input keeps the focus, as on a click on a hit.
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={(event) => {
              event.preventDefault();
              onDocs();
            }}
          >
            {help.keyReference === true ? "Entry in the keyboard reference" : "Reference page"}
          </a>
        </>
      )}
    </p>
  </>
);

/** The keys that only modify another one. */
const MODIFIERS: ReadonlySet<string> = new Set(["Control", "Meta", "Shift", "Alt", "AltGraph"]);

/**
 * The command help (SR-210 AK3), a panel that slides in from the right over the hits while it is `open`, and back
 * out, shorter, when it closes (AK4); the motion and its times are in styles.css (`.help-drawer`), and without
 * motion it stands at once (AK7). It shows the help it showed last, also while it slides out. It scrolls
 * with the wheel and, from the input, with the keys of the list (AK4). Its text can be selected and copied: a
 * press that selects nothing gives the focus back to the input, and a key pressed while it has the focus acts in
 * the input (`onKey`), except the key that copies and a modifier alone.
 */
const HelpDrawer = ({
  help: { open, shown, marked, scroller },
  mac,
  docs,
  onKey,
  onRest,
}: {
  readonly help: CommandHelpState;
  readonly mac: boolean;
  /** F1 of the prompt (`Prompt.help`), which the link does too; absent without documentation. */
  readonly docs: ((choice: Choice | undefined) => void) | undefined;
  readonly onKey: (event: React.KeyboardEvent) => void;
  readonly onRest: () => void;
}): React.JSX.Element => (
  <div className="help-frame">
    <div
      ref={scroller}
      className="help-drawer"
      id="command-help"
      data-open={String(open)}
      tabIndex={-1}
      {...(open ? { role: "region", "aria-label": "Command help" } : { "aria-hidden": true, inert: true })}
      onMouseUp={() => {
        if (document.getSelection()?.isCollapsed !== false) {
          onRest();
        }
      }}
      onKeyDown={(event) => {
        // A modifier alone, as the first key of Ctrl/Cmd+C, keeps the selection too.
        if (MODIFIERS.has(event.key) || matches(event, COPY_SHORTCUT, mac)) {
          event.stopPropagation();
          return;
        }
        onRest();
        onKey(event);
      }}
    >
      {shown === undefined ? null : (
        <HelpContent
          help={shown}
          mac={mac}
          onDocs={
            docs === undefined
              ? undefined
              : () => {
                  docs(marked);
                }
          }
        />
      )}
    </div>
  </div>
);

/**
 * The card of a prompt: its hits, if it has any, and the explanation line under them, if there is one. The
 * command help (`drawer`) lies over the hits; while it is `helpOpen` the hits are dimmed and blurred, and the
 * card is at its full height (SR-210 AK3). It is the same card throughout, so it does not slide in again when the
 * help comes or goes; it only changes its height (SR-182 AK4). The wheel over the dimmed hits scrolls the help
 * (`onWheel`).
 */
const PromptCard = ({
  hits,
  list,
  explanation,
  drawer,
  helpOpen,
  onWheel,
}: {
  readonly hits: boolean;
  readonly list: React.JSX.Element;
  readonly explanation: React.JSX.Element | null;
  readonly drawer: React.JSX.Element | null;
  readonly helpOpen: boolean;
  readonly onWheel: (event: React.WheelEvent) => void;
}): React.JSX.Element | null =>
  !hits && explanation === null ? null : (
    <Card>
      {hits ? (
        <div className="card-hits" data-help={helpOpen ? "open" : "closed"} onWheel={onWheel}>
          {list}
          {drawer}
        </div>
      ) : null}
      {explanation}
    </Card>
  );

/**
 * The attributes of the input that name the hits: `shown` of them, the `selected` one if one is `marked`; none, and
 * not expanded, while the command help takes their place (`helpOpen`).
 */
const listAttributes = (
  helpOpen: boolean,
  shown: number,
  marked: boolean,
  selected: number,
): Readonly<Record<string, string | boolean | undefined>> =>
  helpOpen
    ? { "aria-expanded": false }
    : {
        "aria-expanded": shown > 0,
        "aria-controls": "candidates",
        "aria-activedescendant": marked ? `candidate-${String(selected)}` : undefined,
      };

/** What the input of the prompt is described by: the open command help, else the explanation line, if any. */
const describedBy = (helpOpen: boolean, explained: boolean): string | undefined => {
  if (helpOpen) {
    return "command-help";
  }
  return explained ? "prompt-explain" : undefined;
};

/** The command help of the marked entry (SR-210 AK3, AK4), as `useCommandHelp` keeps it. */
interface CommandHelpState {
  /** Whether it is open: its entry is the marked one. */
  readonly open: boolean;
  /** The marked entry, unless it only informs. */
  readonly marked: Choice | undefined;
  /** The help shown last, which the panel keeps while it slides out. */
  readonly shown: CommandHelp | undefined;
  /** The panel, which scrolls. */
  readonly scroller: React.RefObject<HTMLDivElement | null>;
  readonly close: () => void;
  /** Opens the help of the marked entry, if it has one, at its top, or closes the help. */
  readonly toggle: () => void;
  /** Scrolls the open help by `by` lines, or pages (`page`). */
  readonly scroll: (by: number, page: boolean) => void;
  /** The wheel over the dimmed hits scrolls the open help; over the help it scrolls by itself (AK4). */
  readonly wheel: (event: React.WheelEvent) => void;
}

/**
 * The command help of `marked`: it is open while the entry it opened for is marked, and closes for good when that
 * entry leaves the hits (SR-210 AK4).
 */
const useCommandHelp = (entry: Choice | undefined): CommandHelpState => {
  const marked = entry?.inert === true ? undefined : entry;
  // The entry whose help is open, by its ID.
  const [helpFor, setHelpFor] = useState<string | undefined>(undefined);
  const scroller = useRef<HTMLDivElement>(null);
  const last = useRef<CommandHelp | undefined>(undefined);
  const open = helpFor !== undefined && marked?.id === helpFor && marked.help !== undefined;
  if (open) {
    last.current = marked.help;
  }
  useEffect(() => {
    if (helpFor !== undefined && !open) {
      setHelpFor(undefined);
    }
  }, [helpFor, open]);
  const close = (): void => {
    setHelpFor(undefined);
  };
  return {
    open,
    marked,
    shown: last.current,
    scroller,
    close,
    toggle: () => {
      if (open) {
        close();
      } else if (marked?.help !== undefined) {
        setHelpFor(marked.id);
        scroller.current?.scrollTo({ top: 0 });
      }
    },
    scroll: (by, page) => {
      const view = scroller.current;
      if (view !== null) {
        const step = page
          ? Math.max(view.clientHeight - 24, 24)
          : Number.parseFloat(getComputedStyle(view).lineHeight);
        view.scrollBy({ top: by * step });
      }
    },
    wheel: (event) => {
      const view = scroller.current;
      if (open && view !== null && !(event.target instanceof Node && view.contains(event.target))) {
        view.scrollBy({ top: event.deltaY });
      }
    },
  };
};

/**
 * The keys of the command help in the input; whether `event` was taken. Ctrl+H, the physical Ctrl key also on
 * macOS (SR-145 AK1, AK4), opens it for the marked entry, nothing for an entry without one (SR-210 AK5), and closes
 * it; in the command line it is never the text's key (on macOS Ctrl+H deletes a character). While it is open (AK4)
 * Escape and Backspace on an empty input (`query`) close it (SR-134 AK2, AK4), the keys of the list scroll it and
 * the mark stays (SR-122 AK1 to AK3, SR-145 AK3), and Enter, Ctrl/Cmd+Enter and Tab do nothing. A key that changes
 * the input closes it where the input changes.
 */
const helpKey = (event: React.KeyboardEvent, help: CommandHelpState, query: string): boolean => {
  const take = (): true => {
    event.preventDefault();
    event.stopPropagation();
    return true;
  };
  if (isCommandHelpKey(event)) {
    help.toggle();
    return take();
  }
  if (!help.open) {
    return false;
  }
  if (event.key === "Escape" || (event.key === "Backspace" && query === "")) {
    help.close();
    return take();
  }
  if (event.key === "Enter" || event.key === "Tab") {
    return take();
  }
  if (event.key === "PageDown" || event.key === "PageUp") {
    help.scroll(event.key === "PageDown" ? 1 : -1, true);
    return take();
  }
  const step = rowStep(event);
  if (step === undefined) {
    return false;
  }
  help.scroll(step * 3, false);
  return take();
};

const PromptLine = ({
  prompt: given,
  onClose,
}: {
  readonly prompt: Prompt;
  readonly onClose: (cancelled: boolean) => void;
}): React.JSX.Element => {
  const [query, setQuery] = useState(given.initial ?? "");
  // The selection while none is chosen: the first row, or none at all while the hits only preview (SR-183).
  const none = given.preview === true ? -1 : 0;
  const [selected, setSelected] = useState(none);
  // The hits shown, with the question they answer.
  const [found, setFound] = useState<Found & { readonly question: number }>({
    question: 0,
    choices: [],
  });
  // The parts that came later (`fill`): the prompt is open and takes keys while they load.
  const [filled, setFilled] = useState<PromptFill | undefined>(undefined);
  const prompt: Prompt = filled === undefined ? given : { ...given, ...filled };
  // What finds more choices for a text: `seek`, else `find` (its choices alone).
  const { seek, find } = prompt;
  const seeker =
    seek ?? (find === undefined ? undefined : (text: string) => find(text).then((choices) => ({ choices })));
  const loading = given.fill !== undefined && filled === undefined;
  // The newest question to core; an older answer that arrives later is dropped.
  const latest = useRef(0);
  // The question answered last, with its text and hits, at once: React shows them (`found`) only in a
  // later render, and a key that comes before it acts on them (#419).
  const answered = useRef(0);
  const answer = useRef<Found & { readonly text: string }>({
    text: "",
    choices: [],
  });
  // The question Enter waits for (SR-119 AK1: "Ctrl+P, text, Enter" typed fast); 0: Enter waits for none.
  const waiting = useRef(0);
  // The key that waits: Ctrl/Cmd+Enter (`more`) or Enter.
  const waitingMore = useRef(false);
  // Enter or Ctrl/Cmd+Enter pressed while the parts of the prompt load: done when they are there.
  const early = useRef<"enter" | "more" | undefined>(undefined);
  // The text typed last, and whether it is still to be searched (typed while `find` was loading). The
  // effect that searches it once the parts are there reads these, not its render's `query`: a key that
  // comes between that render and its effect would be taken back (ThomasBirkmaier/ReqSeq-archive#757).
  const typed = useRef(given.initial ?? "");
  // The question whose answer an Enter on stale hits took: the prompt closes in a later render, and a key
  // that comes before it must not take that answer again (#419).
  const taken = useRef(0);
  const unsearched = useRef(false);
  // Whether an Enter waits (`waiting` or `early`), shown as "searching…", so a person or a test sees that
  // it is not taken yet (#467).
  const [pending, setPending] = useState(false);

  useEffect(
    () => () => {
      // A late answer must not open anything after the prompt closed.
      waiting.current = 0;
    },
    [],
  );

  useEffect(() => {
    let live = true;
    void given.fill?.then((parts) => {
      if (live) {
        setFilled(parts);
      }
    });
    return () => {
      // The prompt closed (Escape, an answer): the parts that arrive later fill nothing.
      live = false;
    };
  }, [given.fill]);

  // The choice for the typed text itself comes first (a folder path of "Open workspace", SR-131 AK5).
  const literalOf = (text: string): Choice[] => {
    const choice = prompt.literal?.(text);
    return choice === undefined ? [] : [choice];
  };
  /**
   * The rows for `text` with what was found for it: the literal choice, then `promptRows`, or only the
   * found ones when they stand `alone` (the folder of a typed path, SR-143 AK1).
   */
  const rowsFor = (text: string, { choices, alone }: Found): PromptRow<Choice>[] => [
    ...literalOf(text).map((item) => ({ item, ranges: [], own: true })),
    ...(alone === true
      ? choices.map((item) => ({ item, ranges: [], own: false }))
      : promptRows(prompt.items, choices, (choice) => choice.name, text, prompt.use)),
  ];
  const rows = rowsFor(query, found);
  const current = rows[selected];
  const help = useCommandHelp(current?.item);
  const helpOpen = help.open;
  // The row picked with the keys, read when an answer arrives: an exact title put first then must not
  // move the selection to another row (#195).
  const picked = useRef<{ readonly at: number; readonly id: string | undefined }>({ at: 0, id: undefined });
  picked.current = { at: selected, id: current?.item.id };
  // The hits shown belong to an older text than the typed one, and the selection is among them or there
  // is none yet (no literal choice and none of the prompt's own rows for this text). Read when a key is
  // pressed: a question asked in this render (`change`) makes the shown hits stale.
  const stale = (): boolean => found.question !== latest.current && current?.own !== true;

  // `typed` is the text the choice was made for; a choice among the command prompt's own items is
  // remembered (SR-121 AK2), never an element found for the text. `more` (Ctrl/Cmd+Enter) takes it with
  // the optional arguments of a catalog command; a choice without them is taken as with Enter.
  const choose = (choice: Choice, typed: string, more = false): void => {
    if (choice.inert === true) {
      return;
    }
    if (choice.complete !== undefined) {
      // In place of the typed text, and the prompt stays open (SR-143 AK1).
      change(choice.complete);
      return;
    }
    if (prompt.items.some((item) => item.id === choice.id)) {
      prompt.use?.record(typed, choice.id);
    }
    onClose(false);
    (more ? (choice.more ?? choice.run) : choice.run)();
  };

  /** Asks `find` for `value`; the answer is shown only while it is the newest question. */
  const search = (seek: (text: string) => Promise<Found>, value: string): void => {
    latest.current += 1;
    const mine = latest.current;
    unsearched.current = false;
    void seek(value).then((result) => {
      if (mine !== latest.current) {
        return;
      }
      answered.current = mine;
      answer.current = { ...result, text: value };
      setFound({ ...result, question: mine });
      const { at, id } = picked.current;
      if (at > 0 || (given.preview === true && at >= 0)) {
        const kept = rowsFor(value, result).findIndex(({ item }) => item.id === id);
        if (kept !== -1) {
          setSelected(kept);
        } else if (given.preview === true) {
          // The hit chosen is not among the new ones: none is chosen (SR-183).
          setSelected(none);
        }
      }
      if (waiting.current === mine) {
        // Enter was pressed before this answer.
        waiting.current = 0;
        taken.current = mine;
        setPending(false);
        takeFirst(waitingMore.current);
      }
    });
  };

  /** The first row of the text answered last, as the list shows it, is chosen. */
  const takeFirst = (more: boolean): void => {
    const { text, ...result } = answer.current;
    const [first] = rowsFor(text, result);
    if (first !== undefined) {
      choose(first.item, text, more);
    }
  };

  /** Enter or Ctrl/Cmd+Enter on stale hits: on the answer to the typed text, at once when it is in. */
  const awaitAnswer = (more: boolean): void => {
    if (taken.current === latest.current) {
      return;
    }
    if (answered.current === latest.current) {
      taken.current = latest.current;
      takeFirst(more);
    } else {
      waiting.current = latest.current;
      waitingMore.current = more;
      setPending(true);
    }
  };

  const change = (value: string): void => {
    // A key that changes the input closes the command help and then acts as without it (SR-210 AK4).
    help.close();
    setQuery(value);
    prompt.typing?.(value);
    setSelected(none);
    typed.current = value;
    // Typing after Enter cancels it, while the answer is awaited (SR-119) and while the parts load.
    waiting.current = 0;
    early.current = undefined;
    setPending(false);
    if (seeker === undefined || value.trim() === "") {
      latest.current += 1;
      answered.current = latest.current;
      answer.current = { text: value, choices: [] };
      unsearched.current = value.trim() !== "";
      setFound({ question: latest.current, choices: [] });
    } else {
      search(seeker, value);
    }
  };

  // Enter: the selected candidate, the typed text, or (empty input) the end of a list argument.
  const enter = (): void => {
    if (query === "" && prompt.empty !== undefined) {
      onClose(false);
      prompt.empty(false);
    } else if (loading) {
      early.current = "enter";
      setPending(true);
    } else if (current === undefined && prompt.preview === true && prompt.text !== undefined) {
      // No hit is chosen: the text is taken at once, whatever hits are on their way (SR-183 AK5).
      onClose(false);
      prompt.text(query);
    } else if (current !== undefined && prompt.preview === true) {
      // The hit chosen is the one opened, even while newer hits are on their way (SR-183 AK4).
      choose(current.item, query);
    } else if (stale()) {
      awaitAnswer(false);
    } else if (current !== undefined) {
      choose(current.item, query);
    } else if (prompt.text !== undefined) {
      onClose(false);
      prompt.text(query);
    }
  };

  // Ctrl/Cmd+Enter: the answer, then the optional arguments of a catalog command; recorded and waiting
  // like Enter. A candidate without optional arguments, or a prompt without them, works as Enter. On an
  // empty input it ends a list argument, as Enter does, and offers the optional arguments.
  const more = (): void => {
    if (query === "" && prompt.empty !== undefined) {
      onClose(false);
      prompt.empty(true);
    } else if (loading) {
      early.current = "more";
      setPending(true);
    } else if (prompt.preview === true) {
      // The search prompt has no optional arguments: as Enter, which never waits there (SR-183 AK4, AK5).
      enter();
    } else if (stale()) {
      awaitAnswer(true);
    } else if (current?.item.more !== undefined) {
      choose(current.item, query, true);
    } else if (current === undefined && prompt.more !== undefined) {
      onClose(false);
      prompt.more(query);
    } else {
      enter();
    }
  };

  useEffect(() => {
    if (filled === undefined) {
      return;
    }
    // The text typed while the parts loaded is searched now, and a key pressed meanwhile acts on them.
    const key = early.current;
    early.current = undefined;
    setPending(false);
    if (seeker !== undefined && unsearched.current) {
      search(seeker, typed.current);
    }
    if (key === "more") {
      more();
    } else if (key === "enter") {
      enter();
    }
  }, [filled]);

  // The modifier of the shortcuts: Cmd only under macOS (`matches`).
  const mac = isMac(navigator.platform);
  // Ctrl/Cmd+Enter (`more`) and Backspace in an empty input (one argument back, catalog commands); never
  // "Follow reference". Whether the key was taken.
  const argumentKey = (event: React.KeyboardEvent): boolean => {
    if (matches(event, MORE_SHORTCUT, mac)) {
      event.preventDefault();
      event.stopPropagation();
      more();
      return true;
    }
    if (event.key !== "Backspace" || query !== "") {
      return false;
    }
    event.stopPropagation();
    if (prompt.back !== undefined) {
      event.preventDefault();
      onClose(false);
      prompt.back();
    }
    return true;
  };

  /** Escape in the first step, or a press outside the minibuffer (SR-134 AK3, SR-156 AK3): the prompt ends without an answer. */
  const cancel = (): void => {
    prompt.cancel?.();
    waiting.current = 0;
    onClose(true);
  };
  const cancelNow = useRef(cancel);
  cancelNow.current = cancel;
  const input = useRef<HTMLInputElement>(null);
  // A press of a mouse button (left, middle, right) anywhere outside the minibuffer and its card ends the
  // whole prompt, in every step, and goes on to what it presses: the prompt is no dialog (D-062). The buttons
  // Back and Forward do nothing while a prompt is open (SR-163), so they do not end it either.
  useEffect(() => {
    const own = input.current?.closest(".minibuffer");
    const page = input.current?.ownerDocument;
    if (own === null || own === undefined || page === undefined) {
      return undefined;
    }
    const press = (event: MouseEvent): void => {
      if (event.button <= 2 && (!(event.target instanceof Node) || !own.contains(event.target))) {
        cancelNow.current();
      }
    };
    page.addEventListener("mousedown", press, true);
    return () => {
      page.removeEventListener("mousedown", press, true);
    };
  }, []);

  /** F1: the documentation of the chosen entry in the browser (SR-141 AK3); the prompt stays open. */
  const docsKey = (event: React.KeyboardEvent): boolean => {
    if (event.key !== HELP_KEY || prompt.help === undefined) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    prompt.help(current?.item.inert === true ? undefined : current?.item);
    return true;
  };

  const keyDown = (event: React.KeyboardEvent): void => {
    // The open command help takes the keys of the list first (SR-210 AK4).
    if (helpKey(event, help, query)) {
      return;
    }
    // Down, Up, Tab and Ctrl+N / Ctrl+P (SR-122) move the selection. They go no further: Ctrl+P is
    // "Go to" in the window, but in an open prompt it only moves the selection, on every platform.
    const step = listStep(event);
    if (step !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      // A row that only informs ("… n more") is never selected.
      const last = rows.findLastIndex(({ item }) => item.inert !== true);
      setSelected(Math.max(none, Math.min(last, selected + step)));
      return;
    }
    // Alt+N, Alt+P and Alt+O (Option on macOS) switch no buffer or area while a prompt is open: they type
    // what the layout gives (Option+N "~" on a German Mac), and go no further.
    if (
      [NEXT_BUFFER_SHORTCUT, PREVIOUS_BUFFER_SHORTCUT, OTHER_WINDOW_SHORTCUT].some((key) =>
        matches(event, key, mac),
      )
    ) {
      event.stopPropagation();
      return;
    }
    if (argumentKey(event) || docsKey(event)) {
      return;
    }
    switch (event.key) {
      case "Enter":
        event.preventDefault();
        if (prompt.step === undefined) {
          enter();
        } else {
          // The prompt stays open: Enter and Shift+Enter step through what the text found (SR-189 AK1).
          prompt.step(query, event.shiftKey);
        }
        break;
      case "Escape":
        event.preventDefault();
        // In a later step one step back, and the prompt stays open (SR-134 AK1); in the first it ends (AK2).
        {
          const back = prompt.back ?? prompt.previous;
          if (back === undefined) {
            cancel();
          } else {
            // A prompt that waited for an answer is told it got none, as when the prompt ends.
            prompt.cancel?.();
            waiting.current = 0;
            onClose(false);
            back();
          }
        }
        break;
    }
  };

  const explained = explanationOf(prompt, current?.item, mac, help.toggle);
  const explanation = explained.line;

  return (
    <>
      <label className="prompt-label" htmlFor="prompt-input">
        {found.note === undefined ? prompt.label : `${found.note} · ${prompt.label}`}
      </label>
      <input
        ref={input}
        id="prompt-input"
        className="prompt-input"
        role="combobox"
        {...listAttributes(helpOpen, rows.length, current !== undefined, selected)}
        aria-describedby={describedBy(helpOpen, explained.said)}
        autoComplete="off"
        spellCheck={false}
        autoFocus
        value={query}
        onChange={(event) => {
          change(event.target.value);
        }}
        onKeyDown={keyDown}
      />
      {pending ? (
        <span className="prompt-waiting" role="status">
          searching…
        </span>
      ) : null}
      <PromptCard
        hits={rows.length > 0}
        explanation={explanation}
        helpOpen={helpOpen}
        onWheel={help.wheel}
        drawer={
          prompt.explains === true ? (
            <HelpDrawer
              help={help}
              mac={mac}
              docs={prompt.help}
              onKey={keyDown}
              onRest={() => {
                input.current?.focus();
              }}
            />
          ) : null
        }
        list={
          <ul
            className="candidates card-list"
            data-explained={String(explanation !== null)}
            id="candidates"
            role="listbox"
            aria-label={prompt.label}
          >
            {rows.map((row, at) => (
              <li
                key={row.item.id}
                id={`candidate-${String(at)}`}
                role="option"
                {...(row.item.inert === true ? { "aria-disabled": true } : {})}
                aria-selected={at === selected}
                {...(given.preview === true
                  ? { className: row.item.snippet === undefined ? "hit" : "hit snipped" }
                  : {})}
                {...(row.item.snippet === undefined
                  ? {}
                  : { "aria-describedby": `candidate-${String(at)}-snippet` })}
                ref={(element) => {
                  if (at === selected) {
                    element?.scrollIntoView({ block: "nearest" });
                  }
                }}
                onMouseDown={(event) => {
                  event.preventDefault();
                  // A click on a dimmed hit only closes the command help (SR-210 AK4, SR-202 AK3).
                  if (helpOpen) {
                    help.close();
                  } else {
                    choose(row.item, query);
                  }
                }}
              >
                <span className="name">
                  {parts(row).map((part, index) =>
                    part.mark ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>,
                  )}
                </span>
                {row.item.hint === undefined ? null : <span className="hint">{row.item.hint}</span>}
                {row.item.snippet === undefined ? null : (
                  <SnippetLine
                    key={row.item.snippet.text}
                    id={`candidate-${String(at)}-snippet`}
                    snippet={row.item.snippet}
                  />
                )}
              </li>
            ))}
          </ul>
        }
      />
    </>
  );
};

/**
 * The rows of the next keys: the key, muted, and the command it runs, in the order of the table; the one
 * Ctrl+N, Ctrl+P or an arrow selected is marked (SR-122 AK6).
 */
const NextKeys = ({
  rows,
}: {
  readonly rows: readonly { readonly key: string; readonly name: string; readonly selected?: boolean }[];
}): React.JSX.Element | null =>
  rows.length === 0 ? null : (
    <Card>
      <ul className="candidates card-list next-keys" role="list" aria-label="Next keys">
        {rows.map((row) => (
          <li key={row.key} aria-current={row.selected === true ? "true" : undefined}>
            <span className="key">{row.key}</span>
            <span className="name">{row.name}</span>
          </li>
        ))}
      </ul>
    </Card>
  );

/** Whether `target` is on the card above the line (the next keys), which is no part of the line. */
const onCard = (target: EventTarget): boolean =>
  target instanceof Element && target.closest(".card") !== null;

export const Minibuffer = ({
  echo,
  prompt,
  onCommand,
  onClose,
  nextKeys,
}: MinibufferProps): React.JSX.Element => {
  // Whether the last press began on the idle line itself: a press that took a hit of the card and is
  // released over the line is no click on it.
  const pressed = useRef(false);
  return (
    <div
      className="minibuffer"
      aria-label="Minibuffer"
      aria-live="polite"
      onMouseDown={(event) => {
        pressed.current = prompt === undefined && !onCard(event.target);
      }}
      // A click anywhere on the idle line, also where it has no message, opens the commands (SR-202 AK1).
      onClick={(event) => {
        const own = pressed.current;
        pressed.current = false;
        if (own && prompt === undefined && !onCard(event.target)) {
          onCommand();
        }
      }}
    >
      {prompt === undefined ? (
        <>
          {nextKeys === undefined ? null : <NextKeys rows={nextKeys} />}
          <div className="echo">{echo}</div>
        </>
      ) : (
        <PromptLine key={prompt.serial} prompt={prompt.prompt} onClose={onClose} />
      )}
    </div>
  );
};
