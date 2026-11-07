// The minibuffer: the one control of the window. Idle it is a single line with the last message; asked
// (a prompt) it is an input with the candidates rising above the modeline, not a dialog, only while asked.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Choice, Prompt, PromptFill } from "./actions.js";
import { NEXT_BUFFER_SHORTCUT, OTHER_WINDOW_SHORTCUT, PREVIOUS_BUFFER_SHORTCUT } from "./actions.js";
import { highlightRanges, highlightTerms } from "./highlight.js";
import type { Part } from "./highlight.js";
import type { Ranked } from "./fuzzy.js";
import { isMac, listStep, matches } from "./keys.js";
import { MORE_SHORTCUT } from "./prompt-keys.js";
import { promptRows } from "./usage.js";

export interface MinibufferProps {
  /** The message shown while idle. */
  readonly echo: string;
  /** The question being asked; `serial` is new for every question, so a new one starts empty. */
  readonly prompt: { readonly serial: number; readonly prompt: Prompt } | undefined;
  /** A click on the idle line: ask for a command. */
  readonly onCommand: () => void;
  /** The prompt ends: Escape (`cancelled`, SR-117 keeps a held access for it), or an answer. */
  readonly onClose: (cancelled: boolean) => void;
  /**
   * The possible next keys after the prefix key, with their commands (SR-109 AK3): shown above the idle
   * line, which says the prefix ("Ctrl+K-"); no input, the focus stays where it is.
   */
  readonly nextKeys?: readonly { readonly key: string; readonly name: string }[] | undefined;
}

const parts = ({ item, ranges }: Ranked<Choice>): Part[] =>
  item.terms === undefined ? highlightRanges(item.name, ranges) : highlightTerms(item.name, item.terms);

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
 * A copy of `node` in `parent` that runs the motion back (SR-182 AK6); it says nothing to a screen reader
 * and is no hit to a test, and it goes when its animation ends. Without motion it goes at once (AK7).
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

const PromptLine = ({
  prompt: given,
  onClose,
}: {
  readonly prompt: Prompt;
  readonly onClose: (cancelled: boolean) => void;
}): React.JSX.Element => {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  // The hits shown, with the question they answer.
  const [found, setFound] = useState<{ readonly question: number; readonly choices: readonly Choice[] }>({
    question: 0,
    choices: [],
  });
  // The parts that came later (`fill`): the prompt is open and takes keys while they load.
  const [filled, setFilled] = useState<PromptFill | undefined>(undefined);
  const prompt: Prompt = filled === undefined ? given : { ...given, ...filled };
  const loading = given.fill !== undefined && filled === undefined;
  // The newest question to core; an older answer that arrives later is dropped.
  const latest = useRef(0);
  // The question answered last, with its text and hits, at once: React shows them (`found`) only in a
  // later render, and a key that comes before it acts on them (#419).
  const answered = useRef(0);
  const answer = useRef<{ readonly text: string; readonly choices: readonly Choice[] }>({
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
  const typed = useRef("");
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
  /** The rows for `text` with the elements core found for it: the literal choice, then `promptRows`. */
  const rowsFor = (text: string, choices: readonly Choice[]): Ranked<Choice>[] => [
    ...literalOf(text).map((item) => ({ item, ranges: [] })),
    ...promptRows(prompt.items, choices, (choice) => choice.name, text, prompt.use),
  ];
  const rows = rowsFor(query, found.choices);
  const current = rows[selected];
  // The hits shown belong to an older text than the typed one, and the selection is among them or there
  // is none yet: it is no literal choice and none of the prompt's own items. Read when a key is pressed: a
  // question asked in this render (`change`) makes the shown hits stale.
  const own = (choice: Choice): boolean =>
    prompt.items.some((item) => item.id === choice.id) ||
    literalOf(query).some((item) => item.id === choice.id);
  const stale = (): boolean =>
    found.question !== latest.current && (current === undefined || !own(current.item));

  // `typed` is the text the choice was made for; a choice among the command prompt's own items is
  // remembered (SR-121 AK2), never an element found for the text. `more` (Ctrl/Cmd+Enter) takes it with
  // the optional arguments of a catalog command; a choice without them is taken as with Enter.
  const choose = (choice: Choice, typed: string, more = false): void => {
    if (prompt.items.some((item) => item.id === choice.id)) {
      prompt.use?.record(typed, choice.id);
    }
    onClose(false);
    (more ? (choice.more ?? choice.run) : choice.run)();
  };

  /** Asks `find` for `value`; the answer is shown only while it is the newest question. */
  const search = (find: (text: string) => Promise<readonly Choice[]>, value: string): void => {
    latest.current += 1;
    const mine = latest.current;
    unsearched.current = false;
    void find(value).then((choices) => {
      if (mine !== latest.current) {
        return;
      }
      answered.current = mine;
      answer.current = { text: value, choices };
      setFound({ question: mine, choices });
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
    const { text, choices } = answer.current;
    const [first] = rowsFor(text, choices);
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
    setQuery(value);
    setSelected(0);
    typed.current = value;
    // Typing after Enter cancels it, while the answer is awaited (SR-119) and while the parts load.
    waiting.current = 0;
    early.current = undefined;
    setPending(false);
    if (prompt.find === undefined || value.trim() === "") {
      latest.current += 1;
      answered.current = latest.current;
      answer.current = { text: value, choices: [] };
      unsearched.current = value.trim() !== "";
      setFound({ question: latest.current, choices: [] });
    } else {
      search(prompt.find, value);
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
    if (prompt.find !== undefined && unsearched.current) {
      search(prompt.find, typed.current);
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

  const keyDown = (event: React.KeyboardEvent): void => {
    // Down, Up, Tab and Ctrl+N / Ctrl+P (SR-122) move the selection. They go no further: Ctrl+P is
    // "Go to" in the window, but in an open prompt it only moves the selection, on every platform.
    const step = listStep(event);
    if (step !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      setSelected(Math.max(0, Math.min(rows.length - 1, selected + step)));
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
    if (argumentKey(event)) {
      return;
    }
    switch (event.key) {
      case "Enter":
        event.preventDefault();
        enter();
        break;
      case "Escape":
        event.preventDefault();
        prompt.cancel?.();
        waiting.current = 0;
        onClose(true);
        break;
    }
  };

  return (
    <>
      <label className="prompt-label" htmlFor="prompt-input">
        {prompt.label}
      </label>
      <input
        id="prompt-input"
        className="prompt-input"
        role="combobox"
        aria-expanded={rows.length > 0}
        aria-controls="candidates"
        aria-activedescendant={current === undefined ? undefined : `candidate-${String(selected)}`}
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
      {rows.length === 0 ? null : (
        <Card>
          <ul className="candidates card-list" id="candidates" role="listbox" aria-label={prompt.label}>
            {rows.map((row, at) => (
              <li
                key={row.item.id}
                id={`candidate-${String(at)}`}
                role="option"
                aria-selected={at === selected}
                ref={(element) => {
                  if (at === selected) {
                    element?.scrollIntoView({ block: "nearest" });
                  }
                }}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(row.item, query);
                }}
              >
                <span className="name">
                  {parts(row).map((part, index) =>
                    part.mark ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>,
                  )}
                </span>
                {row.item.hint === undefined ? null : <span className="hint">{row.item.hint}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
};

/** The rows of the next keys: the key, muted, and the command it runs, in the order of the table. */
const NextKeys = ({
  rows,
}: {
  readonly rows: readonly { readonly key: string; readonly name: string }[];
}): React.JSX.Element | null =>
  rows.length === 0 ? null : (
    <Card>
      <ul className="candidates card-list next-keys" role="list" aria-label="Next keys">
        {rows.map((row) => (
          <li key={row.key}>
            <span className="key">{row.key}</span>
            <span className="name">{row.name}</span>
          </li>
        ))}
      </ul>
    </Card>
  );

export const Minibuffer = ({
  echo,
  prompt,
  onCommand,
  onClose,
  nextKeys,
}: MinibufferProps): React.JSX.Element => (
  <div className="minibuffer" aria-label="Minibuffer" aria-live="polite">
    {prompt === undefined ? (
      <>
        {nextKeys === undefined ? null : <NextKeys rows={nextKeys} />}
        <div className="echo" onClick={onCommand}>
          {echo}
        </div>
      </>
    ) : (
      <PromptLine key={prompt.serial} prompt={prompt.prompt} onClose={onClose} />
    )}
  </div>
);
