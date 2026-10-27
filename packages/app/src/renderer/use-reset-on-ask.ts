// A view that loads its rows from what its buffer asks for (a list, a search, a matrix). React runs the
// effect that asks again only after the commit, so the first commit for another question would show the
// rows of the question before under the name of the new one, and a key pressed meanwhile would act on
// them: Ctrl+N was lost on the empty list that followed, Enter opened a row of the list before. The reset
// runs while rendering instead (React's "adjusting state when a prop changes"), so no commit shows them.
import { useState } from "react";

/**
 * Calls `reset` in the render in which a value of `asked` differs (`Object.is`) from the render before.
 * `asked` is a fixed list of values: they are compared place by place, a change of its length is not seen.
 */
export const useResetOnAsk = (asked: readonly unknown[], reset: () => void): void => {
  const [before, setBefore] = useState(asked);
  if (asked.some((value, at) => !Object.is(value, before[at]))) {
    setBefore(asked);
    reset();
  }
};
