// The value of a kept async state when its build has ended, without waiting for a build that runs
// (ADR-0008: single-element paths such as `element.get` use a whole-workspace state only when it is
// there already, and otherwise compute what they need for their one element).

/** What a race with a settled promise gives when the promise is still pending. */
const PENDING: unique symbol = Symbol("pending");

/**
 * The value of `promise` when it is fulfilled already, else undefined (also for no promise). Never
 * waits for a pending one: the reaction of a settled promise is queued before the one of the
 * promise made after it, so a fulfilled `promise` wins the race. A rejected one rejects here: a
 * kept state that failed is a bug (`Workspace` drops a rejected state).
 */
export const settledValue = async <T>(promise: Promise<T> | undefined): Promise<T | undefined> => {
  if (promise === undefined) {
    return undefined;
  }
  const first = await Promise.race([promise, Promise.resolve(PENDING)]);
  return first === PENDING ? undefined : first;
};
