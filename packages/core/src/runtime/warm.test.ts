import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { STANDARD_MODEL_TEXT } from "../metamodel/standard-model.js";
import { elementStoreState, incomingState, shortIdState } from "../model/index.js";
import { SEARCH_CACHE_FILE } from "../query/search-cache.js";
import { searchElements } from "../query/search-index.js";
import { searchIndex, searchIndexState } from "../query/search-state.js";
import { warmWorkspace } from "./warm.js";
import { Workspace } from "./workspace.js";

const N1 = "6adc6d88-2177-457b-959d-545b7b379da2";

describe("warmWorkspace (SR-082)", () => {
  it("loads the model before it resolves and starts the search index later in the background", async () => {
    const fixture = await createFixtureWorkspace({
      files: {
        "logreq-workspace.yaml":
          "logreq-workspace: 1\nname: W\nrepositories:\n  - { name: system, url: x }\nmetamodel: { repository: system, path: metamodel }\n",
        "metamodel/standard-model.yaml": STANDARD_MODEL_TEXT,
        "needs/N-545b7b379da2.md": `---\nid: ${N1}\ntype: need\nstatus: draft\ntitle: Wind\n---\n`,
      },
    });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    await warmWorkspace(workspace, 10);
    // Nothing of the search index on the way to the first answer (SR-082 AK1).
    expect(workspace.peek(searchIndexState)).toBeUndefined();
    const store = await workspace.peek(elementStoreState);
    expect(store?.elements).toHaveLength(1);
    expect(workspace.peek(shortIdState)).toBeDefined();
    expect(store === undefined ? undefined : workspace.peek(incomingState)?.get(store)?.store).toBe(store);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(workspace.peek(searchIndexState)).toBeDefined();
    expect(searchElements(await searchIndex(workspace), "wind").hits.map((h) => h.element.id)).toEqual([N1]);
  });

  it("makes a search during the warm-up build the index without the cache, as a server does", async () => {
    const fixture = await createFixtureWorkspace({
      files: {
        "logreq-workspace.yaml":
          "logreq-workspace: 1\nname: W\nrepositories:\n  - { name: system, url: x }\nmetamodel: { repository: system, path: metamodel }\n",
        "metamodel/standard-model.yaml": STANDARD_MODEL_TEXT,
        "needs/N-545b7b379da2.md": `---\nid: ${N1}\ntype: need\nstatus: draft\ntitle: Wind\n---\n`,
      },
    });
    onTestFinished(() => fixture.cleanup());
    const cacheFolder = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-warm-cache-"));
    onTestFinished(() => fs.rm(cacheFolder, { recursive: true, force: true }));
    const workspace = new Workspace(fixture.root, { cacheFolder });
    // As `reqseq mcp` and the app do it: the warm-up is not awaited before the first command.
    const warming = warmWorkspace(workspace, 60_000);
    const index = await searchIndex(workspace);
    expect(searchElements(index, "wind").total).toBe(1);
    await warming;
    await workspace.close();
    await expect(fs.readdir(cacheFolder)).resolves.not.toContain(SEARCH_CACHE_FILE);
  });

  it("never rejects, also for a workspace that is closed or cannot be read", async () => {
    const fixture = await createFixtureWorkspace({ files: {} });
    onTestFinished(() => fixture.cleanup());
    const broken = new Workspace(fixture.root);
    onTestFinished(() => broken.close());
    await expect(warmWorkspace(broken, 0)).resolves.toBeUndefined();
    // The search index then fails to build in the background, unseen until a search asks.
    await new Promise((resolve) => setTimeout(resolve, 40));
    await expect(searchIndex(broken)).rejects.toThrow();
    const closed = new Workspace(fixture.root);
    await closed.close();
    await expect(warmWorkspace(closed)).resolves.toBeUndefined();
  });
});
