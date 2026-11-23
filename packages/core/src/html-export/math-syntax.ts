// The syntax of formulas in the HTML export (SR-231 AK5), as an extension of micromark and mdast (the cases
// of `@reqseq/testkit`'s `MATH_SYNTAX_CASES` run against it).
//
// - `inlineMath`: `$…$` within a line. The opening `$` is followed by a character that is no white space, the
//   closing `$` follows one and is not followed by a digit (so "costs $5 and $10" holds no formula); `\$` is an
//   escaped dollar, also inside the formula. `$$…$$` within a line is a formula in display style. A formula does
//   not span lines. Code, autolinks and link destinations are parsed before a `$` in them is seen.
// - `math`: a line that is only `$$`, the lines of the formula, and a line that is only `$$`, without a blank line
//   between them. It is a formula only once its closing line is there; otherwise the lines are an ordinary
//   paragraph. A line that starts another block ends it as it ends a paragraph, and so does a line the container
//   does not continue. It does not interrupt a paragraph. Its lines are not parsed as Markdown.
// - Fenced code with the info string `math` is a formula too: a `code` node, which `markdown.ts` recognises.
import type { CompileContext, Extension as FromMarkdownExtension, Token } from "mdast-util-from-markdown";
import type { Code, Construct, Effects, Extension, State, TokenizeContext } from "micromark-util-types";

declare module "micromark-util-types" {
  interface TokenTypeMap {
    inlineMath: "inlineMath";
    inlineMathSequence: "inlineMathSequence";
    inlineMathData: "inlineMathData";
    mathFlow: "mathFlow";
    mathFlowFence: "mathFlowFence";
    mathFlowValue: "mathFlowValue";
  }
}

/** A formula node of the mdast: `inlineMath` within a line (`display` for `$$…$$`), `math` for a block. */
export interface MathNode {
  readonly type: "inlineMath" | "math";
  value: string;
  display: boolean;
}

const DOLLAR = 36;
const BACKSLASH = 92;
const SPACE = 32;

/** A line ending or the end of the text (micromark's codes below -2 and null). */
const isEnd = (code: Code): boolean => code === null || code < -2;
/** White space, also a line ending (tab: -2, virtual space: -1). */
const isSpace = (code: Code): boolean =>
  code === SPACE || code === -1 || code === -2 || (code !== null && code < -2);
const isDigit = (code: Code): boolean => code !== null && code >= 48 && code <= 57;

/** `$…$` and `$$…$$` within a line. */
const inlineMath: Construct = {
  name: "inlineMath",
  tokenize(effects: Effects, ok: State, nok: State): State {
    let open = 0;
    let previous: Code = null;
    let filled = false;
    const closing: Construct = {
      partial: true,
      tokenize(inner: Effects, done: State, fail: State): State {
        const second: State = (code) => {
          if (code !== DOLLAR) {
            return fail(code);
          }
          inner.consume(code);
          inner.exit("inlineMathSequence");
          return done;
        };
        return (code) => {
          inner.enter("inlineMathSequence");
          inner.consume(code);
          return second;
        };
      },
    };
    const end: State = (code) => {
      // The single closing `$` is not followed by a digit.
      if (open === 1 && isDigit(code)) {
        return nok(code);
      }
      effects.exit("inlineMath");
      return ok(code);
    };
    // The data token is entered at its first character and left before a `$`, since micromark takes no empty token.
    let inData = false;
    const take = (code: Code): void => {
      if (!inData) {
        effects.enter("inlineMathData");
        inData = true;
      }
      previous = code;
      effects.consume(code);
    };
    const leave = (): void => {
      if (inData) {
        effects.exit("inlineMathData");
        inData = false;
      }
    };
    const data: State = (code) => {
      if (isEnd(code)) {
        return nok(code);
      }
      if (code === DOLLAR) {
        leave();
        if (open === 2) {
          return effects.attempt(closing, (next) => (filled ? end(next) : nok(next)), inDollar)(code);
        }
        // The first `$` ends it, or there is no formula: it follows a character that is no white space.
        if (isSpace(previous)) {
          return nok(code);
        }
        effects.enter("inlineMathSequence");
        effects.consume(code);
        effects.exit("inlineMathSequence");
        return end;
      }
      filled ||= !isSpace(code);
      take(code);
      return code === BACKSLASH ? escaped : data;
    };
    /** A `$` within `$$…$$` that closes nothing. */
    const inDollar: State = (code) => {
      filled = true;
      take(code);
      return data;
    };
    const escaped: State = (code) => {
      if (isEnd(code)) {
        return nok(code);
      }
      take(code);
      return data;
    };
    const opening: State = (code) => {
      if (code === DOLLAR && open < 2) {
        open += 1;
        effects.consume(code);
        return opening;
      }
      effects.exit("inlineMathSequence");
      return open === 1 && isSpace(code) ? nok(code) : data(code);
    };
    return (code) => {
      effects.enter("inlineMath");
      effects.enter("inlineMathSequence");
      return opening(code);
    };
  },
};

/**
 * The characters of a line as text, consumed by `effects` into a token of `type` (none for an empty line, since
 * micromark takes no empty token); `done` gets the text at the line ending.
 */
const lineOf = (
  effects: Effects,
  type: "mathFlowFence" | "mathFlowValue",
  done: (text: string) => State,
): State => {
  // Built character by character: spreading a long line into `String.fromCodePoint` exceeds the call stack.
  let text = "";
  let entered = false;
  const rest: State = (code) => {
    // `isEnd`, written out so that `code` is a number after it.
    if (code === null || code < -2) {
      if (entered) {
        effects.exit(type);
      }
      return done(text)(code);
    }
    if (!entered) {
      effects.enter(type);
      entered = true;
    }
    text += String.fromCodePoint(code < 0 ? SPACE : code);
    effects.consume(code);
    return rest;
  };
  return rest;
};

/** Whether `line` would start another block and so end a paragraph (or the formula). */
const startsBlock = (line: string): boolean =>
  /^ {0,3}(?:#{1,6}(?:[ \t]|$)|>|[-+*][ \t]|1[.)][ \t]|`{3}|~{3}|<|(?:[-*_][ \t]*){3,}$|=+[ \t]*$)/u.test(
    line,
  );

/** A line that is only `$$` (up to three spaces before it, any white space after it). */
const isFence = (line: string): boolean => /^ {0,3}\$\$[ \t]*$/u.test(line);

/** A line the container of the formula continues (the next line is not lazy). */
const nonLazy: Construct = {
  partial: true,
  tokenize(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
    return (code) => {
      effects.enter("lineEnding");
      effects.consume(code);
      effects.exit("lineEnding");
      return (next) => (this.parser.lazy[this.now().line] === true ? nok(next) : ok(next));
    };
  },
};

/** `$$` lines with the formula between them. */
const mathFlow: Construct = {
  name: "mathFlow",
  concrete: true,
  tokenize(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
    /** After a line of the formula: the next one, once the container continues it. */
    const lineEnd: State = (code) =>
      code === null ? nok(code) : effects.attempt(nonLazy, nextLine, nok)(code);
    const nextLine: State = (code) =>
      lineOf(effects, "mathFlowValue", (text) => {
        if (isFence(text)) {
          return (end) => {
            effects.exit("mathFlow");
            return ok(end);
          };
        }
        return text.trim() === "" || startsBlock(text) ? nok : lineEnd;
      })(code);
    return (code) => {
      if (this.interrupt === true) {
        return nok(code);
      }
      effects.enter("mathFlow");
      return lineOf(effects, "mathFlowFence", (text) => (isFence(text) ? lineEnd : nok))(code);
    };
  },
};

/** The micromark extension of the file comment. */
export const mathSyntax = (): Extension => ({
  text: { [DOLLAR]: inlineMath },
  flow: { [DOLLAR]: mathFlow },
});

/** The node on top of the stack of `context`, a formula while one is open. */
const top = (context: CompileContext): MathNode => context.stack.at(-1) as unknown as MathNode;

/** Whether the node on top of `context` lies in the label of an image: a fragment on the stack right above an image. */
const inImageLabel = (context: CompileContext): boolean => {
  const types = (context.stack as readonly { readonly type: string }[]).map((node) => node.type);
  return types.some((type, i) => type === "fragment" && types[i - 1] === "image");
};

/** The mdast extension of the file comment: `inlineMath` and `math` nodes with their source as written. */
export const mathFromMarkdown = (): FromMarkdownExtension => ({
  enter: {
    inlineMath(this: CompileContext, token: Token) {
      this.enter({ type: "inlineMath", value: "", display: false } as never, token);
    },
    mathFlow(this: CompileContext, token: Token) {
      this.enter({ type: "math", value: "", display: true } as never, token);
    },
  },
  exit: {
    inlineMath(this: CompileContext, token: Token) {
      const node = top(this);
      const source = this.sliceSerialize(token);
      if (inImageLabel(this)) {
        // The label of an image becomes its alt text, which keeps the formula as written.
        Object.assign(node, { type: "text", value: source });
        this.exit(token);
        return;
      }
      const open = source.startsWith("$$") ? 2 : 1;
      node.value = source.slice(open, -open);
      node.display = open === 2;
      this.exit(token);
    },
    mathFlowValue(this: CompileContext, token: Token) {
      // The closing `$$` line is a value line too; it is dropped when the block ends.
      const node = top(this);
      node.value = `${node.value}${this.sliceSerialize(token)}\n`;
    },
    mathFlow(this: CompileContext, token: Token) {
      const node = top(this);
      node.value = node.value.split("\n").slice(0, -2).join("\n");
      this.exit(token);
    },
  },
});
