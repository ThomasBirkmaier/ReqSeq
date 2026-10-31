// The open buffers of a workspace, stored for the next start (SR-115 AK4): what is stored, what comes
// back, and what is left out.
import { describe, expect, it, vi } from "vitest";
import type { CommandListing } from "../shared/protocol.js";
import type { CommandErrorObject, FilterCondition } from "@reqseq/core";
import type { Buffer, FilterStep } from "./buffers.js";
import {
  MAX_BUFFERS,
  elementBuffer,
  filteredList,
  graphBuffer,
  metamodelBuffer,
  neighbourhoodBuffer,
  overviewBuffer,
  readOnlyBuffer,
  resultBuffer,
  searchBuffer,
} from "./buffers.js";
import type { SessionStorage, StoredSession } from "./buffer-session.js";
import {
  NO_SESSION,
  RESTORED_REVISION,
  loadSession,
  restoreSession,
  saveSession,
  sessionKey,
  sessionText,
} from "./buffer-session.js";
import type { Call } from "./call.js";

const memory = (
  content: Record<string, string> = {},
): SessionStorage & { content: Record<string, string> } => ({
  content,
  getItem: (key) => content[key] ?? null,
  setItem: (key, value) => {
    content[key] = value;
  },
});

const row = (n: number, repository = "spec") => ({
  id: `uuid-${String(n)}`,
  shortId: `SR-00000${String(n)}`,
  identifier: `SR-${String(n)}`,
  type: "need",
  status: "draft",
  title: `Secret title ${String(n)}`,
  repository,
  file: `f${String(n)}.md`,
  properties: {},
  relations: [],
});

type Handler = (
  input: Record<string, unknown>,
) => { ok: true; output: unknown } | { ok: false; code: CommandErrorObject["code"] };

/** A fake `call` with these answers; every call is recorded. */
const fakeCall = (handlers: Record<string, Handler>) => {
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  const call = ((name: string, input: Record<string, unknown>) => {
    calls.push({ name, input });
    const answer = handlers[name]?.(input) ?? { ok: false, code: "command.not-implemented" };
    return Promise.resolve(answer.ok ? answer : { ok: false, code: answer.code, message: answer.code });
  }) as unknown as Call;
  return { call, calls };
};

/** `element.list` answers the elements named, of those that exist. */
const listing =
  (...existing: ReturnType<typeof row>[]): Handler =>
  (input) => {
    const ids = (input["selection"] as { ids: string[] }).ids;
    return { ok: true, output: { elements: existing.filter((e) => ids.includes(e.id)), total: 0 } };
  };

const command = (name: string, effect: "read" | "write", implemented = true): CommandListing =>
  ({ name, effect, implemented, title: name, arguments: [] }) as unknown as CommandListing;

const CATALOG = (): Promise<readonly CommandListing[]> => Promise.resolve(CATALOG_LIST);

const step = (label: string, where: FilterCondition): FilterStep => ({ label, selection: { where } });

/** One buffer of every kind, as the app holds them (with rows selected and an output). */
const everyKind = (): Buffer[] => [
  { ...searchBuffer("wind"), cursor: 3 },
  { ...elementBuffer("uuid-1", "spec", "SR-1 Secret title 1"), memberSort: [{ by: "title", order: "desc" }] },
  overviewBuffer(),
  {
    ...filteredList(
      [step("type: Need", { type: ["need"] }), step("status: draft", { status: ["draft"] })],
      [{ by: "hierarchy", order: "asc" }],
      true,
    ),
    cursor: 5,
  },
  { ...neighbourhoodBuffer("uuid-2", "spec", "SR-2 Secret title 2"), open: ["spec:uuid-2"], cursor: 1 },
  {
    ...graphBuffer("uuid-3", "other", "SR-3 Secret title 3"),
    depth: "all",
    kinds: ["refines"],
    meanings: ["derivation"],
    view: "core",
    selected: "spec:uuid-1",
  },
  { ...metamodelBuffer("text"), selected: "type:need" },
  {
    ...resultBuffer("evidence.list", { ref: "SR-1" }, "List evidence SR-1", { secret: "output" }, 7),
    cursor: 0,
  },
];

const names = fakeCall({ "element.list": listing(row(1), row(2), row(3, "other")) });

describe("buffer session (SR-115 AK4)", () => {
  it("[SR-115/AK4] stores and restores every kind of buffer with its order of use", async () => {
    const buffers = everyKind();
    const storage = memory();
    saveSession(() => storage, "key", sessionText(buffers));

    const restored = await restoreSession(
      loadSession(() => storage, "key"),
      names.call,
      CATALOG,
    );

    expect(restored.buffers.map((buffer) => buffer.key)).toEqual(buffers.map((buffer) => buffer.key));
    // What rebuilds a buffer comes back; the selected rows and the output do not (a list starts with no row
    // selected, a result runs again when it is shown).
    const [search, element, overview, list, neighbourhood, graph, metamodel, result] = restored.buffers;
    expect(search).toEqual(searchBuffer("wind"));
    expect(element).toEqual({
      ...elementBuffer("uuid-1", "spec", "SR-1 Secret title 1"),
      memberSort: [{ by: "title", order: "desc" }],
    });
    expect(overview).toEqual(overviewBuffer());
    expect(list).toEqual(
      filteredList(
        [step("type: Need", { type: ["need"] }), step("status: draft", { status: ["draft"] })],
        [{ by: "hierarchy", order: "asc" }],
        true,
      ),
    );
    expect(neighbourhood).toEqual({
      ...neighbourhoodBuffer("uuid-2", "spec", "SR-2 Secret title 2"),
      open: ["spec:uuid-2"],
    });
    expect(graph).toEqual({
      ...graphBuffer("uuid-3", "other", "SR-3 Secret title 3"),
      depth: "all",
      kinds: ["refines"],
      meanings: ["derivation"],
      view: "core",
    });
    expect(metamodel).toEqual(metamodelBuffer("text"));
    expect(result).toEqual(
      resultBuffer("evidence.list", { ref: "SR-1" }, "List evidence SR-1", undefined, RESTORED_REVISION),
    );
    // Buffers as they open first, with nothing chosen, come back the same; an element shown read-only
    // (SR-044 AK2) comes back read-only.
    const plain = [
      filteredList([]),
      elementBuffer("uuid-1", "spec", "SR-1 Secret title 1"),
      readOnlyBuffer(elementBuffer("uuid-1", "spec", "SR-1 Secret title 1")),
      graphBuffer("uuid-3", "other", "SR-3 Secret title 3"),
    ];
    saveSession(() => storage, "plain", sessionText(plain));
    const again = await restoreSession(
      loadSession(() => storage, "plain"),
      names.call,
      CATALOG,
    );
    expect(again).toEqual({ buffers: plain, complete: true });
    // The names come from one read of the elements by their UUIDs; nothing is written.
    expect(names.calls).toEqual([
      { name: "element.list", input: { selection: { ids: ["uuid-1", "uuid-2", "uuid-3"] } } },
      { name: "element.list", input: { selection: { ids: ["uuid-1", "uuid-3"] } } },
    ]);
  });

  it("[SR-115/AK4] keeps nothing of a storage that throws or holds something else, and stores no title or text", () => {
    const buffers = everyKind();
    const text = sessionText(buffers);
    // Neither an element's title nor the output of a result is stored, and no selected row.
    expect(text).not.toContain("Secret title");
    expect(text).not.toContain("secret");
    expect(text).not.toContain("cursor");
    expect(text).not.toContain("type:need");
    // A storage that throws: nothing is restored, and storing it fails quietly.
    const broken = (): SessionStorage => {
      throw new Error("no storage");
    };
    expect(loadSession(broken, "key")).toEqual(NO_SESSION);
    expect(() => {
      saveSession(broken, "key", text);
    }).not.toThrow();
    const failing = memory();
    failing.setItem = () => {
      throw new Error("quota");
    };
    expect(() => {
      saveSession(() => failing, "key", text);
    }).not.toThrow();
    // Nothing stored, broken or foreign content.
    for (const content of [undefined, "{", "[]", "null", '"text"', '{"buffers":"none"}']) {
      const storage = memory(content === undefined ? {} : { key: content });
      expect(loadSession(() => storage, "key")).toEqual(NO_SESSION);
    }
    // An entry that is no buffer of this app is left out, the others stay in their order.
    const foreign = memory({
      key: JSON.stringify({
        buffers: [
          { kind: "search", query: "wind" },
          { kind: "tab" },
          "element",
          { kind: "list", steps: [{ label: 1 }] },
          { kind: "list", steps: [{ label: "x", selection: { where: "type" } }] },
          { kind: "list", steps: [{ label: "x", selection: { filter: 1 } }] },
          { kind: "list", steps: [], sort: [{ by: "title", order: "up" }] },
          { kind: "list", steps: [], sort: "title" },
          { kind: "search" },
          { kind: "element", id: "uuid-1" },
          { kind: "element", id: "uuid-1", repository: "spec", memberSort: "title" },
          { kind: "neighbourhood", id: "uuid-1", repository: "spec", open: [1] },
          { kind: "graph", id: "uuid-1", repository: "spec", depth: 0 },
          { kind: "graph", id: "uuid-1", repository: "spec", depth: 1.5 },
          { kind: "graph", id: "uuid-1", repository: "spec", depth: 1, kinds: "refines" },
          { kind: "graph", id: "uuid-1", repository: "spec", depth: 1, meanings: [1] },
          { kind: "graph", id: "uuid-1", repository: "spec", depth: 1, view: 1 },
          { kind: "metamodel", mode: "tree" },
          { kind: "result", command: "evidence.list", input: [], name: "x" },
          { kind: "result", command: "evidence.list", input: {} },
          { kind: "metamodel", mode: "graph" },
          {
            kind: "list",
            steps: [{ label: "status: draft", selection: { where: { status: "draft" }, filter: "mine" } }],
            matrix: "yes",
          },
        ],
      }),
    });
    expect(loadSession(() => foreign, "key")).toEqual({
      buffers: [
        { kind: "search", query: "wind" },
        { kind: "metamodel", mode: "graph" },
        {
          kind: "list",
          steps: [{ label: "status: draft", selection: { where: { status: "draft" }, filter: "mine" } }],
        },
      ],
    });
    // At most the buffers the app keeps.
    const many = memory({
      key: JSON.stringify({
        buffers: Array.from({ length: MAX_BUFFERS + 5 }, (_, n) => ({ kind: "search", query: String(n) })),
      }),
    });
    expect(loadSession(() => many, "key").buffers).toHaveLength(MAX_BUFFERS);
  });

  it("[SR-115/AK4] stores per workspace", () => {
    const status = (name: string, repositories?: object[]) => ({
      ok: true as const,
      output: { name, readOnly: false, ...(repositories === undefined ? {} : { repositories }) },
    });
    const one = sessionKey(status("Weather", [{ name: "spec", available: true, path: "." }]));
    expect(one?.split("\n")).toEqual(["reqseq.buffers.v1", "Weather", "spec=."]);
    expect(sessionKey(status("Weather", [{ name: "spec", available: true, path: "x" }]))).not.toBe(one);
    expect(sessionKey(status("Other", [{ name: "spec", available: true, path: "." }]))).not.toBe(one);
    expect(sessionKey(status("Weather"))?.split("\n")).toEqual(["reqseq.buffers.v1", "Weather"]);
    expect(sessionKey(status("Weather", [{ name: "spec", available: false }]))).toContain("spec=");
    expect(
      sessionKey({ ok: false, error: { code: "workspace.not-found", message: "No workspace" } }),
    ).toBeUndefined();
  });

  it("[SR-115/AK4] leaves out an element that is gone and a result that is no implemented read command", async () => {
    const session: StoredSession = {
      buffers: [
        { kind: "element", id: "uuid-1", repository: "spec" },
        { kind: "element", id: "uuid-9", repository: "spec" },
        { kind: "graph", id: "uuid-1", repository: "spec", depth: 2 },
        { kind: "result", command: "element.setStatus", input: { refs: ["SR-1"] }, name: "Set status" },
        { kind: "result", command: "evidence.list", input: {}, name: "List evidence" },
        { kind: "result", command: "trace.plan", input: {}, name: "Plan" },
        { kind: "search", query: "wind" },
        { kind: "search", query: "wind" },
      ],
    };
    // The read of all names fails when one element is gone: each is read by itself.
    const { call, calls } = fakeCall({
      "element.list": () => ({ ok: false, code: "ref.unknown" }),
      "element.get": (input) =>
        input["ref"] === "uuid-1"
          ? { ok: true, output: { element: row(1) } }
          : { ok: false, code: "ref.unknown" },
    });
    const restored = await restoreSession(session, call, () =>
      Promise.resolve([...CATALOG_LIST, command("trace.plan", "read", false)]),
    );
    expect(restored.buffers.map((buffer) => buffer.key)).toEqual([
      "element:spec:uuid-1",
      "graph:spec:uuid-1",
      "result:evidence.list:{}",
      "search:wind",
    ]);
    expect(calls.map((made) => made.name)).toEqual(["element.list", "element.get", "element.get"]);
    // An element that is gone leaves the restore complete: the stored session may be overwritten.
    expect(restored.complete).toBe(true);
    // Without the catalog no result comes back; without anything stored nothing is read.
    const offline = await restoreSession(session, call, () => Promise.reject(new Error("no catalog")));
    expect(offline.buffers.some((buffer) => buffer.kind === "result")).toBe(false);
    const quiet = vi.fn<() => Promise<readonly CommandListing[]>>();
    expect(await restoreSession(NO_SESSION, call, quiet)).toEqual({
      buffers: [],
      complete: true,
    });
    expect(quiet).not.toHaveBeenCalled();
    // Buffers that name no element read no names and no catalog.
    const before = calls.length;
    expect(await restoreSession({ buffers: [{ kind: "overview" }] }, call, quiet)).toEqual({
      buffers: [overviewBuffer()],
      complete: true,
    });
    expect(calls).toHaveLength(before);
    expect(quiet).not.toHaveBeenCalled();
  });

  it("[SR-115/AK4] a name that cannot be read for another reason than a gone element makes the restore incomplete", async () => {
    const session: StoredSession = {
      buffers: [
        { kind: "element", id: "uuid-1", repository: "spec" },
        { kind: "element", id: "uuid-2", repository: "spec" },
        { kind: "search", query: "wind" },
      ],
    };
    // Core restarting: every read answers `internal`.
    const failing = fakeCall({
      "element.list": () => ({ ok: false, code: "internal" }),
      "element.get": () => ({ ok: false, code: "internal" }),
    });
    const restored = await restoreSession(session, failing.call, CATALOG);
    expect(restored.complete).toBe(false);
    expect(restored.buffers.map((buffer) => buffer.key)).toEqual(["search:wind"]);
    // One element gone, the other not read (no workspace open): still incomplete.
    const mixed = fakeCall({
      "element.list": () => ({ ok: false, code: "ref.unknown" }),
      "element.get": (input) =>
        input["ref"] === "uuid-1"
          ? { ok: false, code: "ref.unknown" }
          : { ok: false, code: "workspace.not-found" },
    });
    expect((await restoreSession(session, mixed.call, CATALOG)).complete).toBe(false);
    // Gone or not unique only: complete.
    const gone = fakeCall({
      "element.list": () => ({ ok: false, code: "ref.ambiguous" }),
      "element.get": (input) =>
        input["ref"] === "uuid-1" ? { ok: false, code: "ref.unknown" } : { ok: false, code: "ref.ambiguous" },
    });
    expect((await restoreSession(session, gone.call, CATALOG)).complete).toBe(true);
  });
});

const CATALOG_LIST = [command("evidence.list", "read"), command("element.setStatus", "write")];
