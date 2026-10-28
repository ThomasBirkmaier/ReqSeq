import { describe, expect, it, vi } from "vitest";
import type { Call } from "./call.js";
import type { ReferenceRequest } from "./editor/reference-pick.js";
import type { ReferenceTarget } from "./editor/slash-entries.js";
import { referenceTitles } from "./reference-titles.js";

const GUSTS = "a7f3c1e9-5b2d-4e8f-b6a4-0e9d7c5b3a21";
const GONE = "11111111-2222-4333-8444-555555555555";

/** A core that knows GUSTS in `sensor`, with `title`, and nothing else. */
const core = (title = "Measure gusts") => {
  const asked: unknown[] = [];
  const call = ((name: string, input: Record<string, unknown>) => {
    asked.push([name, input]);
    return Promise.resolve(
      input["ref"] === GUSTS
        ? { ok: true, output: { element: { title } } }
        : { ok: false, code: "ref.unknown", message: "No element" },
    );
  }) as unknown as Call;
  return { call, asked };
};

const target = (extra: Partial<ReferenceTarget> = {}): ReferenceTarget => ({
  id: GUSTS,
  title: "Measure gusts",
  label: "N-0e9d7c",
  shortId: "N-0e9d7c",
  repository: "sensor",
  ...extra,
});

describe("referenceTitles (D-058)", () => {
  it("asks core once for the title of a target and keeps it, also when it is not here", async () => {
    const { call, asked } = core();
    const titles = referenceTitles(call);
    expect(await titles.title(GUSTS, "sensor")).toBe("Measure gusts");
    expect(await titles.title(GUSTS, "sensor")).toBe("Measure gusts");
    expect(await titles.title(GONE, "sensor")).toBeUndefined();
    expect(await titles.title(GONE, "sensor")).toBeUndefined();
    expect(asked).toEqual([
      ["element.get", { ref: GUSTS, repository: "sensor" }],
      ["element.get", { ref: GONE, repository: "sensor" }],
    ]);
  });

  it("takes an empty title for none", async () => {
    expect(await referenceTitles(core("").call).title(GUSTS, "sensor")).toBeUndefined();
  });

  it("keeps the title of a picked target, so the reference just written asks nothing", async () => {
    const { call, asked } = core();
    const titles = referenceTitles(call);
    const insert = vi.fn<ReferenceRequest["insert"]>();
    const cancel = vi.fn();
    const request = titles.picking({ insert, cancel });
    expect(request.cancel).toBe(cancel);
    request.insert(target({ title: " Böen messen ", repository: "other repo" }));
    expect(insert).toHaveBeenCalledExactlyOnceWith(
      target({ title: " Böen messen ", repository: "other repo" }),
    );
    // The reference names the repository percent-encoded, as `referenceMarkdown` writes it.
    expect(await titles.title(GUSTS, "other%20repo")).toBe("Böen messen");
    // A target without a title is asked of core.
    titles.picking({ insert, cancel }).insert(target({ title: " " }));
    expect(await titles.title(GUSTS, "sensor")).toBe("Measure gusts");
    expect(asked).toHaveLength(1);
  });

  it("keeps no failure but ref.unknown: core stopped or restarting is asked again", async () => {
    const answers = [
      Promise.resolve({ ok: false, code: "workspace.not-found", message: "Core restarts" }),
      Promise.reject(new Error("The bridge is gone")),
      Promise.resolve({ ok: true, output: { element: { title: " Measure gusts " } } }),
    ];
    const call = vi.fn(() => answers.shift()) as unknown as Call;
    const titles = referenceTitles(call);
    expect(await titles.title(GUSTS, "sensor")).toBeUndefined();
    expect(await titles.title(GUSTS, "sensor")).toBeUndefined();
    // A title from core is shown as a picked one is: trimmed.
    expect(await titles.title(GUSTS, "sensor")).toBe("Measure gusts");
    expect(await titles.title(GUSTS, "sensor")).toBe("Measure gusts");
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("a failure that comes after a pick of the same target keeps the title of the pick", async () => {
    let fail = (): void => undefined;
    const pending = new Promise((resolve) => {
      fail = () => {
        resolve({ ok: false, code: "workspace.not-found", message: "Core restarts" });
      };
    });
    const call = vi
      .fn()
      .mockReturnValueOnce(pending)
      .mockResolvedValue({ ok: true, output: { element: { title: "Asked again" } } }) as unknown as Call;
    const titles = referenceTitles(call);
    const asked = titles.title(GUSTS, "sensor");
    titles.clear();
    titles.picking({ insert: vi.fn(), cancel: vi.fn() }).insert(target());
    fail();
    expect(await asked).toBeUndefined();
    expect(await titles.title(GUSTS, "sensor")).toBe("Measure gusts");
    expect(call).toHaveBeenCalledOnce();
  });

  it("forgets every title when cleared: another workspace is open, or core restarted", async () => {
    const { call, asked } = core();
    const titles = referenceTitles(call);
    await titles.title(GUSTS, "sensor");
    titles.clear();
    await titles.title(GUSTS, "sensor");
    expect(asked).toHaveLength(2);
  });
});
