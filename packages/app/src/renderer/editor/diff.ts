// The smallest single change that turns `from` into `to`: the common beginning and end stay. The editor
// applies it when the text changes from outside, so the cursor stays where it was.
export interface Change {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

export const minimalChange = (before: string, after: string): Change => {
  let start = 0;
  while (start < before.length && start < after.length && before.charAt(start) === after.charAt(start)) {
    start += 1;
  }
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before.charAt(before.length - 1 - end) === after.charAt(after.length - 1 - end)
  ) {
    end += 1;
  }
  return { from: start, to: before.length - end, insert: after.slice(start, after.length - end) };
};
