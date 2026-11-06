// fixtures/SR-089/missing-targets with its requirement "Warn of gusts" of `sensor` copied into `system`:
// two elements share its UUID (SR-088, D-058), for the inputs repository and file of the trace commands
// (#821). Its relation kind derives-from gets the meaning derivation (SR-013).
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { onTestFinished } from "vitest";
import { Workspace } from "../runtime/workspace.js";

/** The UUID both copies have, and the file of each copy in its repository. */
export const GUSTS_COPY = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
export const GUSTS_FILE = "anemometer/SR-1e0f9a8b7c6d.md";

/** The workspace `system` of the fixture with the copy, and `files` (relative to the fixture root) added. */
export const openCopied = async (files: Readonly<Record<string, string>> = {}): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-089/missing-targets", files });
  onTestFinished(() => fixture.cleanup());
  await mkdir(fixture.path("system/anemometer"), { recursive: true });
  await copyFile(fixture.path(`sensor/${GUSTS_FILE}`), fixture.path(`system/${GUSTS_FILE}`));
  const model = fixture.path("system/metamodel/model.yaml");
  const derivesFrom = "{ key: derives-from, name: Derives from, inverse-name: Derived by";
  await writeFile(
    model,
    (await readFile(model, "utf8")).replace(derivesFrom, `${derivesFrom}, meaning: derivation`),
  );
  const workspace = new Workspace(fixture.path("system"));
  onTestFinished(() => workspace.close());
  return workspace;
};
