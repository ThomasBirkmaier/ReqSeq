// Core's versions for the generator of the performance suite (D-055): the version every generated
// relation and inline reference stores is the one core computes for its target (ADR-0005), so a
// generated workspace has no outdated relation (SR-025) unless a test changes a target on purpose.
// A module of the suite, not a test file: it uses core only (the testkit is for test files, ADR-0011);
// `versionOf` has the shape of the testkit's `VersionFunction`.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Metamodel } from "../../src/metamodel/index.js";
import { STANDARD_MODEL_TEXT, findType, metamodelState } from "../../src/metamodel/index.js";
import { Workspace } from "../../src/runtime/workspace.js";
import type { VersionValue } from "../../src/version/version.js";
import { computeVersion } from "../../src/version/version.js";

/** What the generator passes for an element (the testkit's `VersionSubject`). */
interface VersionSubject {
  readonly type: string;
  readonly text: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

/** The standard model as a workspace reads it. */
export const standardModel = async (): Promise<Metamodel> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-standard-model-"));
  try {
    await fs.mkdir(path.join(root, "metamodel"));
    await fs.writeFile(
      path.join(root, "reqseq-workspace.yaml"),
      'reqseq-workspace: 1\nname: Model\nrepositories:\n  - { name: system, url: "x" }\nmetamodel: { repository: system, path: metamodel }\n',
    );
    await fs.writeFile(path.join(root, "metamodel", "standard-model.yaml"), STANDARD_MODEL_TEXT);
    const workspace = new Workspace(root);
    try {
      return await workspace.get(metamodelState);
    } finally {
      await workspace.close();
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
};

/** Core's version (ADR-0005) for the generator, like `elementVersion` does it for a read element. */
export const versionOf =
  (metamodel: Metamodel): ((element: VersionSubject) => string) =>
  ({ type, text, properties }) => {
    const keys = new Set(findType(metamodel, type)?.properties ?? []);
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
