// Shared by the specs of the property boxes (SR-104, SR-127): the workspace of SR-069/filter with the
// metamodel flag `markdown: true` on the acceptance criteria, as the standard model has it.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";

export const FIXTURE_FOLDER = fileURLToPath(new URL("../../../../fixtures/SR-069/filter", import.meta.url));

/** The metamodel of the fixture with `markdown: true` on the acceptance criteria. */
export const markdownMetamodel = async (): Promise<string> => {
  const file = await fs.readFile(path.join(FIXTURE_FOLDER, "metamodel", "standard-model.yaml"), "utf8");
  const marked = file.replace(
    "  - key: acceptance-criteria\n    name: Acceptance Criteria\n    kind: text\n    many: true\n",
    "  - key: acceptance-criteria\n    name: Acceptance Criteria\n    kind: text\n    many: true\n    markdown: true\n",
  );
  expect(marked).not.toBe(file);
  return marked;
};

/** A YAML double-quoted string. */
export const quoted = (value: string): string => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
