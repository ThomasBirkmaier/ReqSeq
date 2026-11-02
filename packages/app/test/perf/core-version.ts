// Core's versions for the generator (D-055), as in packages/cli/test/perf/start.test.ts: every generated relation
// stores the version core computes for its target (ADR-0005), so the generated workspace has no outdated relation
// (SR-025) and the app starts on data like a real workspace's.
import fs from "node:fs/promises";
import type { CommandOutput, VersionValue } from "@reqseq/core";
import { Workspace, computeVersion, invoke } from "@reqseq/core";
import type { VersionFunction } from "@reqseq/testkit";
import { createFixtureWorkspace, defaultStandardModelFile } from "@reqseq/testkit";

type Metamodel = CommandOutput<"metamodel.get">;

/** The standard model as `metamodel.get` gives it for a workspace with the generator's model file. */
const standardModel = async (): Promise<Metamodel> => {
  const fixture = await createFixtureWorkspace({
    files: {
      "reqseq-workspace.yaml":
        'reqseq-workspace: 1\nname: Model\nrepositories:\n  - { name: system, url: "x" }\nmetamodel: { repository: system, path: metamodel }\n',
      "metamodel/standard-model.yaml": await fs.readFile(defaultStandardModelFile, "utf8"),
    },
  });
  const workspace = new Workspace(fixture.root);
  try {
    return (await invoke("metamodel.get", {}, { workspace })) as Metamodel;
  } finally {
    await workspace.close();
    await fixture.cleanup();
  }
};

/** Core's version (ADR-0005) for the generator, from the effective properties of each type. */
export const coreVersion = async (): Promise<VersionFunction> => {
  const metamodel = await standardModel();
  return ({ type, text, properties }) => {
    const keys = new Set(metamodel.types.find((t) => t.key === type)?.properties ?? []);
    return computeVersion({
      text,
      properties: properties as Readonly<Record<string, VersionValue>>,
      definitions: metamodel.properties
        .filter((p) => keys.has(p.key))
        .map((p) => ({
          key: p.key,
          kind: p.kind,
          ...(p.content === undefined ? {} : { content: p.content }),
        })),
      files: [],
    });
  };
};
