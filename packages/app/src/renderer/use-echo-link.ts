// A message of the command line that opens something on a click (SR-223 AK8): the answer of a write command,
// whose output a click opens in a result buffer. The link holds only while the line shows its message: any
// other message set by `echo`, also the same text or the empty line before a command, ends it, and so does
// another workspace opened (`end`).
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useState } from "react";

interface Link {
  readonly text: string;
  readonly open: () => void;
}

export interface EchoLink {
  /** Says `message` in the command line; a click on it runs `open`. */
  readonly report: (message: string, open: () => void) => void;
  /** The `echo` to give every other caller: it ends the link. */
  readonly echo: Dispatch<SetStateAction<string>>;
  /** Ends the link and keeps the message: another workspace opened, whose outputs these are not. */
  readonly end: () => void;
  /** What a click on the shown line `line` runs, if it is the reported message. */
  readonly openOf: (line: string) => (() => void) | undefined;
}

export const useEchoLink = (setEcho: Dispatch<SetStateAction<string>>): EchoLink => {
  const [link, setLink] = useState<Link | undefined>(undefined);
  const report = useCallback(
    (message: string, open: () => void): void => {
      setLink({ text: message, open });
      setEcho(message);
    },
    [setEcho],
  );
  const echo = useCallback(
    (next: SetStateAction<string>): void => {
      setLink(undefined);
      setEcho(next);
    },
    [setEcho],
  );
  const end = useCallback((): void => {
    setLink(undefined);
  }, []);
  const openOf = (line: string): (() => void) | undefined => (link?.text === line ? link.open : undefined);
  return { report, echo, end, openOf };
};
