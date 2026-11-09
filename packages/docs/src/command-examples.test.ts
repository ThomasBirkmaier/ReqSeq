import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { argvFor } from "@reqseq/cli";
import type { CatalogEntry } from "@reqseq/core";
import { getCommandRuntime } from "@reqseq/core";
import { describe, expect, it } from "vitest";
import {
  BASELINE_TIME,
  SHOWN_ROOT,
  SHOWN_TIME,
  WITHOUT_EXAMPLE,
  checkExampleInputs,
  commandExamples,
  readExampleInputs,
  shellWord,
  stable,
} from "./command-examples.js";
import { commandWords } from "./examples.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const runtime = getCommandRuntime();

const entry = (name: string): CatalogEntry => {
  const found = runtime.contracts.entry(name);
  if (found === undefined) {
    throw new Error(name);
  }
  return found;
};

describe("command examples", () => {
  it("runs the example of every command on the weather station, the same on every build", async () => {
    const inputs = await readExampleInputs(repoRoot);
    const entries = runtime.contracts.commands;
    const first = await commandExamples(entries, inputs, runtime);
    expect(first.size).toBe(entries.length - Object.keys(WITHOUT_EXAMPLE).length);
    for (const command of entries) {
      const example = first.get(command.name);
      if (example === undefined) {
        continue;
      }
      // The shown line is the call that ran, and the guide's parser reads it back word for word.
      expect(commandWords(example.cli), command.name).toEqual([
        "reqseq",
        ...argvFor(command, example.input, runtime.contracts.schemas),
        "--json",
      ]);
      expect(() => JSON.parse(example.output) as unknown, command.name).not.toThrow();
      expect(example.output, command.name).not.toContain(tmpdir());
    }
    expect(first.get("element.get")?.output).toContain('"title": "Show the wind speed"');
    expect(first.get("element.create")?.output).toContain('"shortId": "SR-000001"');
    expect(first.get("element.create")?.output).toContain('"file": "system-requirement/SR-000000000001.md"');
    expect(first.get("baseline.list")?.output).toContain(`"date": "${BASELINE_TIME}"`);
    expect(first.get("baseline.create")?.output).toContain(`"date": "${SHOWN_TIME}"`);
    expect(first.get("workspace.recent")?.output).toContain(`"root": "${SHOWN_ROOT}"`);
    const second = await commandExamples(entries, inputs, runtime);
    expect([...second]).toEqual([...first]);
  }, 120_000);

  it("fails with every command whose example fails, and passes over a command without one", async () => {
    await expect(
      commandExamples(
        [entry("element.get"), entry("tool.info")],
        new Map([["element.get", { ref: "SR-ffffff" }]]),
        runtime,
        { "tool.info": "Shows the build." },
      ),
    ).rejects.toThrow(
      /failing command examples\nelement\.get: `reqseq element get SR-ffffff --json`: exit code 2\n/,
    );
  });

  it("needs an example or a reason for every command, and a command for every example", () => {
    const entries = [entry("element.get"), entry("tool.info")];
    expect(() => {
      checkExampleInputs(entries, new Map([["element.get", {}]]), { "tool.info": "Shows the build." });
    }).not.toThrow();
    expect(() => {
      checkExampleInputs(
        entries,
        new Map([
          ["no.such", {}],
          ["element.get", {}],
        ]),
        {
          "element.get": "None.",
        },
      );
    }).toThrow(
      [
        "docs: command examples",
        "tool.info: no example in schemas/examples/commands/tool.info.json",
        "schemas/examples/commands/no.such.json: no command no.such",
        "element.get: an example and a reason for none",
      ].join("\n"),
    );
    expect(() => {
      checkExampleInputs(entries, new Map());
    }).toThrow("element.get: no example");
  });

  it("quotes a word of a command line only where a shell needs it", () => {
    expect(shellWord("SR-c67baa")).toBe("SR-c67baa");
    expect(shellWord("--set=a,b:c/d.e@f%g+h")).toBe("--set=a,b:c/d.e@f%g+h");
    expect(shellWord("Release 1")).toBe("'Release 1'");
    expect(shellWord('{"a":"it\'s"}')).toBe(`'{"a":"it'"'"'s"}'`);
    expect(shellWord("")).toBe("''");
  });

  it("fixes the folder, new UUIDs with their tails, and the time and date of the run", () => {
    const from = new Date("2026-11-09T10:00:00.000Z");
    const to = new Date("2026-11-09T10:00:02.000Z");
    const known = new Set(["dd7fe8a3-8e25-4d5d-a764-58b371c67baa"]);
    const fresh = "e5d986e2-4599-46f3-aad8-75e0fc4276ef";
    const output = [
      '"/tmp/x/ws/a.md"',
      "dd7fe8a3-8e25-4d5d-a764-58b371c67baa SR-c67baa",
      `${fresh} SR-75e0fc4276ef.md SR-fc4276ef SR-4276ef`,
      "2026-11-09T10:00:01.123Z 2026-11-09T10:00:03Z 2026-11-09T09:59:59Z 2026-11-09T10:00:04Z",
      "2026-11-09 2026-11-08",
    ].join("\n");
    expect(stable(output, { folders: [["/tmp/x/ws", SHOWN_ROOT]], known, from, to })).toBe(
      [
        `"${SHOWN_ROOT}/a.md"`,
        "dd7fe8a3-8e25-4d5d-a764-58b371c67baa SR-c67baa",
        "00000000-0000-4000-8000-000000000001 SR-000000000001.md SR-fc4276ef SR-000001",
        `${SHOWN_TIME} ${SHOWN_TIME} ${SHOWN_TIME} 2026-11-09T10:00:04Z`,
        "2026-11-05 2026-11-08",
      ].join("\n"),
    );
  });
});
