// The frame of the metamodel commands (SR-236 AK5, AK9, AK10, AK12) over each relation kind command:
// metamodel.addRelationKind, metamodel.changeRelationKind and metamodel.removeRelationKind, on the
// small model of the test helper (the relation kind `about` targets hazards; `causes` is unused).
import fs from "node:fs/promises";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandName, CommandOutput } from "../../catalog.js";
import {
  MODEL,
  SMALL_MODEL,
  elements,
  failure,
  openSmall,
  run,
  uuid,
} from "../metamodel-commands.test-helper.js";

/** The small model with an unused relation kind `causes` after `about`. */
const MODEL_TEXT = SMALL_MODEL.replace("statuses:\n", "  - { key: causes, name: Causes }\nstatuses:\n");

/** One call of each command that writes on `MODEL_TEXT`. */
const CALLS: readonly (readonly [CommandName, Record<string, unknown>])[] = [
  ["metamodel.addRelationKind", { name: "Mitigates", targetTypes: ["hazard"] }],
  ["metamodel.changeRelationKind", { kind: "about", name: "Regards", targetTypes: ["note"] }],
  ["metamodel.removeRelationKind", { kind: "causes" }],
];

/** Simulates a metamodel repository this process cannot write (a POSIX platform, see isWritableFolder). */
const readOnly = (folder: string): void => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: "linux" });
  const access = fs.access.bind(fs);
  vi.spyOn(fs, "access").mockImplementation((target, mode) =>
    target === folder
      ? Promise.reject(Object.assign(new Error("EROFS"), { code: "EROFS" }))
      : access(target, mode),
  );
  onTestFinished(() => {
    vi.restoreAllMocks();
    if (platform !== undefined) {
      Object.defineProperty(process, "platform", platform);
    }
  });
};

describe("metamodel commands: the frame over the relation kind commands (SR-236)", () => {
  it.each(CALLS)(
    "[SR-236/AK-cv7t] %s refuses on a read-only metamodel repository and on a metamodel that does not read, and writes nothing",
    async (command, input) => {
      const locked = await openSmall({}, MODEL_TEXT);
      readOnly(locked.fixture.root);
      const denied = await failure(locked.workspace, command, input);
      expect([denied.code, denied.message, denied.details]).toEqual([
        "file.read-only",
        `The metamodel repository system is read-only; ${command} changes no file`,
        { repository: "system" },
      ]);
      expect(await locked.read(MODEL)).toBe(MODEL_TEXT);
      vi.restoreAllMocks();

      const broken = `${MODEL_TEXT}types: [\n`;
      const faulty = await openSmall({}, broken);
      const unreadable = await failure(faulty.workspace, command, input);
      expect(unreadable.code).toBe("workspace.read-only");
      expect(unreadable.details).toMatchObject({ problems: [{ code: "file.invalid-yaml", file: MODEL }] });
      expect(await faulty.read(MODEL)).toBe(broken);
    },
  );

  it.each(CALLS)(
    "[SR-236/AK-drrw] %s: the next command of the same process works with the new metamodel",
    async (command, input) => {
      const { workspace } = await openSmall(elements([1, "hazard"], [2, "note"]), MODEL_TEXT);
      const before = await run<CommandOutput<"metamodel.get">>(workspace, "metamodel.get", {});
      await run(workspace, command, input);
      const after = await run<CommandOutput<"metamodel.get">>(workspace, "metamodel.get", {});
      expect(after.relations).not.toEqual(before.relations);
      expect(after.uses.relations).toEqual(after.relations.map((r) => ({ key: r.key, count: 0 })));
    },
  );

  it("[SR-236/AK-drrw] counts no element: a relation kind is no definition the version or the required properties depend on", async () => {
    // A note whose file holds `mitigates` before the kind exists, and notes that name it as required.
    const model = MODEL_TEXT.replace(
      "    required: [title]\n    statuses: [draft, noted]\n",
      "    required: [title, mitigates]\n    statuses: [draft, noted]\n",
    );
    const files = elements(
      [1, "hazard"],
      [2, "note", { mitigates: `[{ id: ${uuid(1)}, version: "n1:0000000000000000" }]` }],
      [3, "note"],
    );
    const { workspace } = await openSmall(files, model);
    const added = await run<CommandOutput<"metamodel.addRelationKind"> & { readonly answer: string }>(
      workspace,
      "metamodel.addRelationKind",
      {
        name: "Mitigates",
        meaning: "derivation",
      },
    );
    expect([added.versionsChanged, added.missingRequired, added.answer]).toEqual([
      0,
      0,
      "Added the relation kind Mitigates; 1 file written; 1 problem.",
    ]);
  });

  it.each(CALLS)(
    "[SR-236/AK-jskb] %s: calls at the same time run one after the other, each on what the one before wrote",
    async (command, input) => {
      const { workspace, read } = await openSmall({}, MODEL_TEXT);
      const results = await Promise.allSettled([
        run(workspace, command, input),
        run(workspace, command, input),
      ]);
      expect(results.map((r) => r.status)).toEqual([
        "fulfilled",
        command === "metamodel.changeRelationKind" ? "fulfilled" : "rejected",
      ]);
      const written = await read(MODEL);
      // The second call saw the first one's file: the same definition is not added or removed twice.
      expect(written.split("Mitigates").length).toBeLessThanOrEqual(2);
      if (command === "metamodel.changeRelationKind") {
        expect((results[1] as PromiseFulfilledResult<{ files: string[] }>).value.files).toEqual([]);
      }
    },
  );

  it.each(CALLS)(
    "[SR-236/AK-rtcn] %s writes the same bytes and gives the same output for the same input and metamodel",
    async (command, input) => {
      const first = await openSmall({}, MODEL_TEXT);
      const second = await openSmall({}, MODEL_TEXT);
      expect(await run(first.workspace, command, input)).toEqual(await run(second.workspace, command, input));
      expect(await first.read(MODEL)).toBe(await second.read(MODEL));
    },
  );
});
