// One Workspace object per workspace root holds all state of that workspace (ADR-0002 rule 7).
// There are no globals: two copies of a workspace never share state or caches (SR-081).
import path from "node:path";

/**
 * A kind of per-workspace state, owned by the module that defines it (metamodel, element store,
 * search index, watcher, ...). Defining a key does not touch `Workspace`, so blocks add state
 * without editing this file.
 *
 * Async state: let `create` return a Promise (`T = Promise<X>`). `get` then returns the same
 * Promise to every caller, so the work runs once. A rejected Promise is dropped, so the next
 * `get` tries again; dropping it this way does not reset dependent states.
 */
export interface WorkspaceState<T> {
  /** For messages and debugging only; keys are compared by identity. */
  readonly name: string;
  /** Builds the state the first time a workspace asks for it. */
  readonly create: (workspace: Workspace) => T;
  /** States built from this one; resetting this one resets them too. */
  readonly dependsOn: readonly WorkspaceState<unknown>[];
  /**
   * Releases the value on `reset`, `replace` and `close` (e.g. stop a watcher). Default: nothing.
   * For async state it runs only after the Promise fulfilled; a rejected build is not disposed.
   */
  dispose(value: T): void | Promise<void>;
  /**
   * Derives this state's next value from its current one when a state it depends on is replaced
   * (`Workspace.replace`), instead of resetting it; undefined resets it. Runs synchronously inside
   * `replace`, after the new value of `change.key` and of every carried dependency is in place, so
   * it may `get` them; a state that is not carried is out by then, and a `get` builds it anew. A
   * hook must not `get` a dependent that comes after it and is not one of its dependencies: that one
   * would be built anew and then overwritten by its own hook, without being disposed. The current
   * value is not disposed: the new one is built from it.
   */
  carry?(value: T, change: StateChange, workspace: Workspace): T | undefined;
}

/** A replaced state, for `WorkspaceState.carry`. */
export interface StateChange {
  readonly key: WorkspaceState<unknown>;
  readonly from: unknown;
  readonly to: unknown;
}

export interface WorkspaceStateOptions<T> {
  /** Reset this state whenever one of these is reset (e.g. hints depend on the metamodel). */
  readonly dependsOn?: readonly WorkspaceState<unknown>[];
  /** Release a value; for async state it gets the fulfilled Promise (`(await value).close()`). */
  readonly dispose?: (value: T) => void | Promise<void>;
  /** Carry the value over a replaced dependency (`WorkspaceState.carry`). Default: reset it. */
  readonly carry?: (value: T, change: StateChange, workspace: Workspace) => T | undefined;
}

/** Define a kind of per-workspace state at module level: `const metamodelState = defineWorkspaceState(...)`. */
export const defineWorkspaceState = <T>(
  name: string,
  create: (workspace: Workspace) => T,
  options: WorkspaceStateOptions<T> = {},
): WorkspaceState<T> => ({
  name,
  create,
  dependsOn: [...(options.dependsOn ?? [])],
  dispose: options.dispose ?? ((): void => undefined),
  ...(options.carry === undefined ? {} : { carry: options.carry }),
});

/** Whether `from` depends on `target`, directly or through other states. */
const dependsOn = (
  from: WorkspaceState<unknown>,
  target: WorkspaceState<unknown>,
  seen = new Set<WorkspaceState<unknown>>(),
): boolean =>
  from.dependsOn.some((d) => {
    if (d === target) {
      return true;
    }
    if (seen.has(d)) {
      return false;
    }
    seen.add(d);
    return dependsOn(d, target, seen);
  });

/**
 * Order states so that every state comes before the states it depends on (dependents first);
 * independent states keep reverse insertion order (newest first).
 */
const dependentsFirst = (keys: readonly WorkspaceState<unknown>[]): WorkspaceState<unknown>[] => {
  const done = new Set<WorkspaceState<unknown>>();
  const dependenciesFirst: WorkspaceState<unknown>[] = [];
  const visit = (key: WorkspaceState<unknown>): void => {
    done.add(key);
    for (const other of keys) {
      if (!done.has(other) && dependsOn(key, other)) {
        visit(other);
      }
    }
    dependenciesFirst.push(key);
  };
  for (const key of keys) {
    if (!done.has(key)) {
      visit(key);
    }
  }
  return dependenciesFirst.reverse();
};

/** How a workspace is opened. */
export interface WorkspaceOptions {
  /**
   * The cache folder of this copy (`cacheFolder(root)`, ADR-0008). With it the element store is
   * loaded through the model cache there and the cache is written after a load (SR-082); without it
   * every load reads all files and nothing is written outside the working tree. The CLI and the
   * servers pass it; tests that do not test the cache leave it out.
   */
  readonly cacheFolder?: string;
}

export class Workspace {
  /** Absolute path of the folder with `reqseq-workspace.yaml` (or the folder a command creates it in). */
  readonly root: string;
  /** The cache folder of the model cache, if this workspace uses one (`WorkspaceOptions`). */
  readonly cacheFolder: string | undefined;
  readonly #state = new Map<WorkspaceState<unknown>, unknown>();
  #closed = false;
  /** Commands that run on this workspace now (`invoke`). */
  #commands = 0;
  /** Write commands among them, and who waits for none to be left (`writesSettled`). */
  #writes = 0;
  readonly #writeWaiters: (() => void)[] = [];

  /** Creates the object only; nothing is read until a command asks for state. */
  constructor(root: string, options: WorkspaceOptions = {}) {
    this.root = path.resolve(root);
    this.cacheFolder = options.cacheFolder;
  }

  /** Whether `close` was called: a long build may stop then, since nobody can read its result. */
  get closed(): boolean {
    return this.#closed;
  }

  /**
   * Whether a command runs on this workspace now (`invoke`, `runCommand`): work in the background
   * (the search index, ADR-0008) waits meanwhile, so that it does not slow the answer down.
   */
  get busy(): boolean {
    return this.#commands > 0;
  }

  /**
   * Runs `command` as a command on this workspace: `busy` while it runs (`invoke`). With `writes`
   * (a `write-files` command), `writesSettled` waits for it too.
   */
  async runCommand<T>(command: () => Promise<T>, options: { readonly writes?: boolean } = {}): Promise<T> {
    const writes = options.writes === true;
    this.#commands += 1;
    if (writes) {
      this.#writes += 1;
    }
    try {
      return await command();
    } finally {
      this.#commands -= 1;
      if (writes) {
        this.#writes -= 1;
        if (this.#writes === 0) {
          for (const resolve of this.#writeWaiters.splice(0)) {
            resolve();
          }
        }
      }
    }
  }

  /**
   * Resolves once no write command runs on this workspace. The watcher waits for it before it looks
   * at a batch, so a file a command of this process is writing counts as that command's, which puts
   * it into the element store itself (`recordWrites`), and not as a change from outside (#432).
   */
  writesSettled(): Promise<void> {
    return this.#writes === 0
      ? Promise.resolve()
      : new Promise((resolve) => {
          this.#writeWaiters.push(resolve);
        });
  }

  /** The state of this workspace for `key`, created on first use and kept until `reset` or `close`. */
  get<T>(key: WorkspaceState<T>): T {
    if (this.#closed) {
      throw new Error(`workspace ${this.root} is closed`);
    }
    if (this.#state.has(key)) {
      return this.#state.get(key) as T;
    }
    const value = key.create(this);
    this.#keep(key, value);
    return value;
  }

  /** The state for `key` if it was built (or is being built), else undefined; never builds it. */
  peek<T>(key: WorkspaceState<T>): T | undefined {
    return this.#state.get(key) as T | undefined;
  }

  /**
   * Replace the state for `key` with `to`, but only while it is still `from` (compare and set, so
   * a reset or another replace in between wins). Every state that depends on `key` is then either
   * carried over or reset: dependencies first, a state with a `carry` hook gets its next value from
   * it when every dependency of it that depends on `key` was carried too; every other one is reset,
   * dependents first, and then `from` is disposed. Used by the watcher and ReqSeq's own writes to
   * update the element store file by file instead of reading it again (SR-007, #166; through
   * `applyStoreChange`), and the states built on it with it (#184). Resolves with whether the value
   * is now `to` (`to` equal to `from` changes nothing). The value is replaced even when a hook or a
   * disposal fails; a failed hook resets its state, and the call then rejects with an
   * `AggregateError` of the failures, as `reset` does.
   */
  async replace<T>(key: WorkspaceState<T>, from: T, to: T): Promise<boolean> {
    if (this.#closed || !this.#state.has(key) || this.#state.get(key) !== from) {
      return false;
    }
    if (to === from) {
      return true;
    }
    this.#keep(key, to);
    const change: StateChange = { key, from, to };
    const dependents = dependentsFirst(
      [...this.#state.keys()].filter((k) => k !== key && dependsOn(k, key)),
    ).map((k) => ({ key: k, value: this.#state.get(k) }));
    // Out first, so that a hook that gets a state which is not carried builds it anew.
    for (const { key: dependent } of dependents) {
      this.#state.delete(dependent);
    }
    const carried = new Set<WorkspaceState<unknown>>([key]);
    /** Failures of `carry` hooks. */
    const errors: unknown[] = [];
    for (const { key: dependent, value } of [...dependents].reverse()) {
      const ready = dependent.dependsOn.every((d) => carried.has(d) || !dependsOn(d, key));
      if (!ready || dependent.carry === undefined) {
        continue;
      }
      try {
        const next = dependent.carry(value, change, this);
        if (next !== undefined) {
          this.#keep(dependent, next);
          carried.add(dependent);
        }
      } catch (error) {
        errors.push(error);
      }
    }
    const dropped = this.#drop([], [...dependents.filter((d) => !carried.has(d.key)), { key, value: from }]);
    if (errors.length === 0) {
      await dropped;
      return true;
    }
    // `#drop` rejects only with the AggregateError of its disposals.
    await dropped.catch((error: unknown) => {
      errors.push(...((error as AggregateError).errors as unknown[]));
    });
    throw new AggregateError(errors, "carrying workspace state failed");
  }

  /** Store a value; a failed async build is dropped so the next `get` retries (the caller still sees the rejection). */
  #keep(key: WorkspaceState<unknown>, value: unknown): void {
    this.#state.set(key, value);
    if (value instanceof Promise) {
      void value.catch(() => {
        if (this.#state.get(key) === value) {
          this.#state.delete(key);
        }
      });
    }
  }

  /**
   * Drop the state for `key` and every state that depends on it, directly or not (e.g. after files
   * changed); the next `get` builds them again. The values are removed at once and then disposed,
   * dependents first, so a `get` during the reset may build new state while the old is disposed.
   */
  async reset(key: WorkspaceState<unknown>): Promise<void> {
    await this.#drop([...this.#state.keys()].filter((k) => k === key || dependsOn(k, key)));
  }

  /** Dispose all state, dependents first. The workspace cannot be used afterwards. */
  async close(): Promise<void> {
    this.#closed = true;
    await this.#drop([...this.#state.keys()]);
  }

  /**
   * Remove the states, then dispose them one after the other, dependents first. Pending async
   * builds are awaited; a rejected one is skipped. Every disposal runs, also when one fails; the
   * failures are reported together.
   */
  async #drop(
    keys: readonly WorkspaceState<unknown>[],
    replaced: readonly { readonly key: WorkspaceState<unknown>; readonly value: unknown }[] = [],
  ): Promise<void> {
    const dropped = dependentsFirst(keys).map((k) => ({ key: k, value: this.#state.get(k) }));
    for (const { key } of dropped) {
      this.#state.delete(key);
    }
    const errors: unknown[] = [];
    // `replaced` values were taken out already; they are disposed after their dependents.
    for (const { key, value } of [...dropped, ...replaced]) {
      try {
        if (value instanceof Promise) {
          const built = await value.then(
            () => true,
            () => false,
          );
          if (!built) {
            continue;
          }
        }
        await key.dispose(value);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "disposing workspace state failed");
    }
  }
}
