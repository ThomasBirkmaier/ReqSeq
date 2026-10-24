import path from "node:path";
import { describe, expect, it, vi } from "vitest";
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
