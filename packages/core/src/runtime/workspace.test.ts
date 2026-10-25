import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { StateChange, WorkspaceState } from "./workspace.js";
import { Workspace, defineWorkspaceState } from "./workspace.js";

describe("Workspace", () => {
  it("keeps the absolute root", () => {
    const root = path.resolve("some", "folder");
    expect(new Workspace(root).root).toBe(root);
    expect(new Workspace(path.join("some", "folder")).root).toBe(root);
  });

  it("creates state on first use and keeps it", () => {
    const create = vi.fn((ws: Workspace) => ({ root: ws.root }));
    const key = defineWorkspaceState("test", create);
    expect(key.name).toBe("test");
    expect(key.dependsOn).toEqual([]);
    const ws = new Workspace("/w");
    const first = ws.get(key);
    expect(first).toEqual({ root: ws.root });
    expect(ws.get(key)).toBe(first);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("keeps undefined state without creating it again", () => {
    const create = vi.fn((): number | undefined => undefined);
    const key = defineWorkspaceState("nothing", create);
    const ws = new Workspace("/w");
    expect(ws.get(key)).toBeUndefined();
    expect(ws.get(key)).toBeUndefined();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("never shares state between workspaces, even for the same root", () => {
    const key = defineWorkspaceState("list", () => [] as string[]);
    const a = new Workspace("/w");
    const b = new Workspace("/w");
    a.get(key).push("x");
    expect(b.get(key)).toEqual([]);
  });

  it("keeps different keys apart", () => {
    const one = defineWorkspaceState("one", () => 1);
    const two = defineWorkspaceState("two", () => 2);
    const ws = new Workspace("/w");
    expect([ws.get(one), ws.get(two)]).toEqual([1, 2]);
  });

  it("builds state again after reset and disposes the old value", async () => {
    let n = 0;
    const dispose = vi.fn();
    const key = defineWorkspaceState("counter", () => ++n, { dispose });
    const ws = new Workspace("/w");
    expect(ws.get(key)).toBe(1);
    await ws.reset(key);
    expect(dispose).toHaveBeenCalledExactlyOnceWith(1);
    expect(ws.get(key)).toBe(2);
    await ws.reset(defineWorkspaceState("unused", () => 0));
    expect(ws.get(key)).toBe(2);
    await ws.reset(key);
    await ws.reset(key);
    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it("shares one Promise for async state and builds it once", async () => {
    const create = vi.fn(() => Promise.resolve("loaded"));
    const key = defineWorkspaceState("async", create);
    const ws = new Workspace("/w");
    const [a, b] = [ws.get(key), ws.get(key)];
    expect(a).toBe(b);
    await expect(a).resolves.toBe("loaded");
    expect(ws.get(key)).toBe(a);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("drops a rejected Promise so the next get tries again", async () => {
    let attempt = 0;
    const key = defineWorkspaceState("flaky", () =>
      ++attempt === 1 ? Promise.reject(new Error("not yet")) : Promise.resolve(attempt),
    );
    const ws = new Workspace("/w");
    await expect(ws.get(key)).rejects.toThrow("not yet");
    await expect(ws.get(key)).resolves.toBe(2);
    await expect(ws.get(key)).resolves.toBe(2);
  });

  it("keeps a newer Promise when an older, reset one rejects", async () => {
    let reject: (e: Error) => void = () => undefined;
    let attempt = 0;
    const key = defineWorkspaceState("slow", () =>
      ++attempt === 1
        ? new Promise<number>((_resolve, rej) => {
            reject = rej;
          })
        : Promise.resolve(attempt),
    );
    const ws = new Workspace("/w");
    const old = ws.get(key);
    const resetting = ws.reset(key);
    // The old value is removed at once, so a get during the reset builds new state.
    const newer = ws.get(key);
    reject(new Error("late"));
    await expect(old).rejects.toThrow("late");
    await expect(resetting).resolves.toBeUndefined();
    expect(ws.get(key)).toBe(newer);
  });

  it("close during a pending build resolves, and disposes only builds that succeeded", async () => {
    let fail: (e: Error) => void = () => undefined;
    let succeed: (v: string) => void = () => undefined;
    const dispose = vi.fn();
    const failing = defineWorkspaceState(
      "failing",
      () =>
        new Promise<string>((_resolve, reject) => {
          fail = reject;
        }),
      { dispose },
    );
    const working = defineWorkspaceState(
      "working",
      () =>
        new Promise<string>((resolve) => {
          succeed = resolve;
        }),
      { dispose },
    );
    const ws = new Workspace("/w");
    const failed = ws.get(failing);
    const built = ws.get(working);
    const closing = ws.close();
    succeed("ok");
    fail(new Error("build failed"));
    await expect(closing).resolves.toBeUndefined();
    await expect(failed).rejects.toThrow("build failed");
    expect(dispose).toHaveBeenCalledExactlyOnceWith(built);
  });

  it("disposes dependents first, also when the dependent was stored before its dependency", async () => {
    const order: string[] = [];
    const base = defineWorkspaceState("base", () => Promise.resolve("base"), {
      dispose: () => {
        order.push("base");
      },
    });
    const derived = defineWorkspaceState(
      "derived",
      async (ws) => {
        await Promise.resolve();
        return `${await ws.get(base)}+derived`;
      },
      {
        dependsOn: [base],
        dispose: () => {
          order.push("derived");
        },
      },
    );
    const ws = new Workspace("/w");
    await expect(ws.get(derived)).resolves.toBe("base+derived");
    await ws.reset(base);
    expect(order).toEqual(["derived", "base"]);
  });

  it("copies dependsOn, so later changes to the array have no effect", async () => {
    const a = defineWorkspaceState("a", () => "a");
    const deps: (typeof a)[] = [];
    const b = defineWorkspaceState("b", () => ({}), { dependsOn: deps });
    deps.push(a);
    const ws = new Workspace("/w");
    const first = ws.get(b);
    ws.get(a);
    await ws.reset(a);
    expect(ws.get(b)).toBe(first);
  });

  it("resets dependent states with their dependency, dependents first", async () => {
    const order: string[] = [];
    const disposeAs = (name: string) => (): void => {
      order.push(name);
    };
    const metamodel = defineWorkspaceState("metamodel", () => "mm", { dispose: disposeAs("metamodel") });
    const model = defineWorkspaceState("model", (ws) => `${ws.get(metamodel)}+model`, {
      dependsOn: [metamodel],
      dispose: disposeAs("model"),
    });
    const hints = defineWorkspaceState("hints", (ws) => `${ws.get(model)}+hints`, {
      dependsOn: [model, metamodel],
      dispose: disposeAs("hints"),
    });
    const unrelated = defineWorkspaceState("unrelated", () => "u", { dispose: disposeAs("unrelated") });
    const ws = new Workspace("/w");
    expect(ws.get(hints)).toBe("mm+model+hints");
    ws.get(unrelated);
    await ws.reset(metamodel);
    expect(order).toEqual(["hints", "model", "metamodel"]);
    expect(ws.get(unrelated)).toBe("u");
    ws.get(hints);
    await ws.reset(metamodel);
    expect(order.slice(3)).toEqual(["hints", "model", "metamodel"]);
  });

  it("finds indirect dependents across states that were never built", async () => {
    const a = defineWorkspaceState("a", () => "a");
    const b = defineWorkspaceState("b", () => "b", { dependsOn: [a] });
    const c = defineWorkspaceState("c", () => ({}), { dependsOn: [b, b] });
    const ws = new Workspace("/w");
    const first = ws.get(c);
    // Unrelated: the walk visits b only once and keeps c.
    await ws.reset(defineWorkspaceState("x", () => "x"));
    expect(ws.get(c)).toBe(first);
    await ws.reset(a);
    expect(ws.get(c)).not.toBe(first);
  });

  it("disposes all state on close and refuses further use", async () => {
    const disposed: string[] = [];
    const one = defineWorkspaceState("one", () => "1", {
      dispose: (v) => {
        disposed.push(v);
      },
    });
    const two = defineWorkspaceState("two", () => Promise.resolve("2"), {
      dispose: async (v) => {
        disposed.push(await v);
      },
    });
    const ws = new Workspace("/w");
    ws.get(one);
    await ws.get(two);
    await ws.close();
    expect([...disposed].sort()).toEqual(["1", "2"]);
    expect(() => ws.get(one)).toThrow(`workspace ${ws.root} is closed`);
  });

  it("disposes everything even when a disposal fails, then reports all failures", async () => {
    const disposed: string[] = [];
    const bad = defineWorkspaceState("bad", () => 0, {
      dispose: () => {
        throw new Error("sync");
      },
    });
    const worse = defineWorkspaceState("worse", () => 0, {
      dispose: () => Promise.reject(new Error("async")),
    });
    const good = defineWorkspaceState("good", () => 0, {
      dispose: () => {
        disposed.push("good");
      },
    });
    const ws = new Workspace("/w");
    ws.get(good);
    ws.get(bad);
    ws.get(worse);
    const error: unknown = await ws.close().then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors.map((e: Error) => e.message)).toEqual(["async", "sync"]);
    expect(disposed).toEqual(["good"]);
  });
});

describe("Workspace.peek and Workspace.replace (SR-007)", () => {
  it("peeks without building", () => {
    const create = vi.fn(() => 1);
    const key = defineWorkspaceState("peeked", create);
    const ws = new Workspace("/w");
    expect(ws.peek(key)).toBeUndefined();
    expect(create).not.toHaveBeenCalled();
    expect(ws.get(key)).toBe(1);
    expect(ws.peek(key)).toBe(1);
  });

  it("replaces a value, resets its dependents and disposes the old value after them", async () => {
    const order: string[] = [];
    const base = defineWorkspaceState("base", () => ({ n: 1 }), {
      dispose: (v) => {
        order.push(`base ${String(v.n)}`);
      },
    });
    let built = 0;
    const derived = defineWorkspaceState("derived", (ws) => ({ n: ws.get(base).n, build: ++built }), {
      dependsOn: [base],
      dispose: () => {
        order.push("derived");
      },
    });
    const other = defineWorkspaceState("other", () => "kept");
    const ws = new Workspace("/w");
    const first = ws.get(base);
    expect(ws.get(derived)).toEqual({ n: 1, build: 1 });
    expect(ws.get(other)).toBe("kept");
    expect(await ws.replace(base, first, { n: 2 })).toBe(true);
    expect(order).toEqual(["derived", "base 1"]);
    expect(ws.get(base)).toEqual({ n: 2 });
    expect(ws.get(derived)).toEqual({ n: 2, build: 2 });
    expect(ws.peek(other)).toBe("kept");
  });

  it("does not replace when the value changed in between, was never built or the workspace is closed", async () => {
    const key = defineWorkspaceState("cas", () => ({ v: 1 }));
    const ws = new Workspace("/w");
    expect(await ws.replace(key, { v: 1 }, { v: 2 })).toBe(false);
    expect(ws.peek(key)).toBeUndefined();
    const first = ws.get(key);
    expect(await ws.replace(key, { v: 1 }, { v: 2 })).toBe(false);
    expect(ws.get(key)).toBe(first);
    await ws.close();
    expect(await ws.replace(key, first, { v: 3 })).toBe(false);
  });

  it("changes nothing when the new value is the old one", async () => {
    const dispose = vi.fn();
    const key = defineWorkspaceState("same", () => ({ v: 1 }), { dispose });
    const derived = defineWorkspaceState("derived-same", (ws) => ws.get(key).v, { dependsOn: [key] });
    const ws = new Workspace("/w");
    const value = ws.get(key);
    ws.get(derived);
    expect(await ws.replace(key, value, value)).toBe(true);
    expect(dispose).not.toHaveBeenCalled();
    expect(ws.peek(derived)).toBe(1);
  });

  it("drops a replacement Promise that rejects, so the next get builds again", async () => {
    let n = 0;
    const key = defineWorkspaceState("async", () => Promise.resolve(++n));
    const ws = new Workspace("/w");
    const first = ws.get(key);
    const failing = Promise.reject(new Error("no"));
    expect(await ws.replace(key, first, failing)).toBe(true);
    await expect(failing).rejects.toThrow("no");
    await Promise.resolve();
    expect(ws.peek(key)).toBeUndefined();
    expect(await ws.get(key)).toBe(2);
  });

  describe("replace with carry hooks (#184)", () => {
    const setup = (
      carry: (value: { n: number }, change: StateChange, ws: Workspace) => { n: number } | undefined,
    ): {
      base: WorkspaceState<{ n: number }>;
      carried: WorkspaceState<{ n: number }>;
      reset: WorkspaceState<{ n: number }>;
      above: WorkspaceState<{ n: number }>;
      disposed: string[];
    } => {
      const disposed: string[] = [];
      const base = defineWorkspaceState("base", () => ({ n: 1 }));
      const carried = defineWorkspaceState("carried", (ws) => ({ n: ws.get(base).n * 10 }), {
        dependsOn: [base],
        carry,
        dispose: () => {
          disposed.push("carried");
        },
      });
      // Carried itself, but built on `reset`, which has no hook: it must be reset too.
      const reset = defineWorkspaceState("reset", (ws) => ({ n: ws.get(base).n * 100 }), {
        dependsOn: [base],
      });
      const above = defineWorkspaceState("above", (ws) => ({ n: ws.get(carried).n + ws.get(reset).n }), {
        dependsOn: [carried, reset],
        carry: (value) => ({ n: value.n }),
      });
      return { base, carried, reset, above, disposed };
    };

    it("derives a dependent's next value from its hook and resets the rest", async () => {
      const seen: StateChange[] = [];
      const { base, carried, reset, above, disposed } = setup((value, change, ws) => {
        seen.push(change);
        // The new value of the replaced state is in place already.
        return { n: value.n + ws.get(base).n };
      });
      const ws = new Workspace("/w");
      const first = ws.get(base);
      expect(ws.get(above)).toEqual({ n: 110 });
      const next = { n: 2 };
      expect(await ws.replace(base, first, next)).toBe(true);
      expect(seen).toEqual([{ key: base, from: first, to: next }]);
      expect(ws.peek(carried)).toEqual({ n: 12 });
      expect(ws.peek(reset)).toBeUndefined();
      expect(ws.peek(above)).toBeUndefined();
      expect(disposed).toEqual([]);
      expect(ws.get(above)).toEqual({ n: 212 });
    });

    it("carries a chain of dependents whose dependencies were all carried", async () => {
      const base = defineWorkspaceState("base", () => 1);
      const middle = defineWorkspaceState("middle", (ws) => ws.get(base) * 10, {
        dependsOn: [base],
        carry: (_value, _change, ws) => ws.get(base) * 10,
      });
      const top = defineWorkspaceState("top", (ws) => ws.get(middle) + 1, {
        dependsOn: [middle, base],
        // Runs after `middle` got its new value.
        carry: (_value, _change, ws) => ws.get(middle) + 1,
      });
      const ws = new Workspace("/w");
      expect(ws.get(top)).toBe(11);
      expect(await ws.replace(base, 1, 2)).toBe(true);
      expect(ws.peek(middle)).toBe(20);
      expect(ws.peek(top)).toBe(21);
    });

    it("lets a hook get a state that is not carried only as built anew", async () => {
      const base = defineWorkspaceState("base", () => 1);
      const plain = defineWorkspaceState("plain", (ws) => ws.get(base) * 10, { dependsOn: [base] });
      const hooked = defineWorkspaceState("hooked", (ws) => ws.get(plain), {
        dependsOn: [base],
        carry: (_value, _change, ws) => ws.get(plain),
      });
      const ws = new Workspace("/w");
      expect(ws.get(hooked)).toBe(10);
      expect(ws.get(plain)).toBe(10);
      expect(await ws.replace(base, 1, 2)).toBe(true);
      expect(ws.peek(hooked)).toBe(20);
      expect(ws.peek(plain)).toBe(20);
    });

    it("resets a dependent whose hook returns undefined, and its dependents", async () => {
      const { base, carried, above, disposed } = setup(() => undefined);
      const ws = new Workspace("/w");
      const first = ws.get(base);
      ws.get(above);
      expect(await ws.replace(base, first, { n: 2 })).toBe(true);
      expect(ws.peek(carried)).toBeUndefined();
      expect(ws.peek(above)).toBeUndefined();
      expect(disposed).toEqual(["carried"]);
    });

    it("runs no hook when the compare and set fails", async () => {
      const carry = vi.fn(() => ({ n: 0 }));
      const { base, carried } = setup(carry);
      const ws = new Workspace("/w");
      ws.get(carried);
      expect(await ws.replace(base, { n: 1 }, { n: 2 })).toBe(false);
      expect(carry).not.toHaveBeenCalled();
      expect(ws.peek(carried)).toEqual({ n: 10 });
    });

    it("resets a dependent whose hook throws, keeps the replacement and reports the failure", async () => {
      const { base, carried, disposed } = setup(() => {
        throw new Error("hook failed");
      });
      const ws = new Workspace("/w");
      const first = ws.get(base);
      ws.get(carried);
      const failure = await ws.replace(base, first, { n: 2 }).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors).toEqual([new Error("hook failed")]);
      expect(ws.peek(base)).toEqual({ n: 2 });
      expect(ws.peek(carried)).toBeUndefined();
      expect(disposed).toEqual(["carried"]);
    });

    it("reports a failed hook together with a failed disposal", async () => {
      const base = defineWorkspaceState("base", () => 1, {
        dispose: () => {
          throw new Error("dispose failed");
        },
      });
      const derived = defineWorkspaceState("derived", (ws) => ws.get(base), {
        dependsOn: [base],
        carry: () => {
          throw new Error("hook failed");
        },
      });
      const ws = new Workspace("/w");
      ws.get(derived);
      const failure = await ws.replace(base, 1, 2).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect((failure as AggregateError).errors).toEqual([
        new Error("hook failed"),
        new Error("dispose failed"),
      ]);
    });

    it("drops a carried Promise that rejects, so the next get builds again", async () => {
      let built = 0;
      const failing = Promise.reject(new Error("no"));
      const base = defineWorkspaceState("base", () => 1);
      const derived = defineWorkspaceState("derived", () => Promise.resolve(++built), {
        dependsOn: [base],
        carry: () => failing,
      });
      const ws = new Workspace("/w");
      ws.get(base);
      await ws.get(derived);
      expect(await ws.replace(base, 1, 2)).toBe(true);
      await expect(failing).rejects.toThrow("no");
      await Promise.resolve();
      expect(ws.peek(derived)).toBeUndefined();
      expect(await ws.get(derived)).toBe(2);
    });
  });
});
