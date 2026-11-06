// tool.info (SR-161): the version of the app, the command line and the MCP server, the build, the runtime
// and the open workspace in one place, read only (AK1); the licence notice, the third-party licences and
// where the documentation and the releases are, as text only: no network connection (AK2, SR-077). One
// delivery ships app, command line and MCP server with one version (AK4, ADR-0014). The runtime is the
// process's: the app's core process and the delivered command line, API and MCP server all run on the
// Electron of the delivery (`ELECTRON_RUN_AS_NODE`), so every access gives the same values (AK5). The
// resource files exist only in a delivery, so they are named only with its build info.
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import type { BuildInfo } from "../../build-info.js";
import { readBuildInfo } from "../../build-info.js";
import { elementStoreState } from "../../model/index.js";
import { PRODUCT_LICENSE, PRODUCT_VERSION } from "../../product.js";
import { workspaceLayoutState } from "../../workspace/index.js";

type Output = CommandOutput<"tool.info">;

/** The addresses the info names as text only; ReqSeq never opens them. */
export const ONLINE_DOCUMENTATION = "https://thomasbirkmaier.github.io/ReqSeq/";
export const RELEASES = "https://github.com/ThomasBirkmaier/ReqSeq/releases";

/** In a delivery, relative to its resources folder (ADR-0014). */
export const THIRD_PARTY_NOTICES = "THIRD_PARTY_NOTICES.txt";
export const BUNDLED_DOCUMENTATION = "docs";

/** What the process tells about itself: the parts of `process` the info reads. */
export interface ProcessFacts {
  readonly versions: { readonly node: string; readonly electron?: string; readonly chrome?: string };
  readonly platform: string;
  readonly arch: string;
}

/** The output without the workspace, from the facts of the process and the build info (if any). */
export const toolFacts = (facts: ProcessFacts, build: BuildInfo | undefined): Omit<Output, "workspace"> => {
  const { electron, node, chrome } = facts.versions;
  const delivered = build !== undefined;
  return {
    versions: { app: PRODUCT_VERSION, cli: PRODUCT_VERSION, mcp: PRODUCT_VERSION },
    build: {
      ...(delivered ? { commit: build.commit, date: build.date } : { development: true as const }),
      platform: facts.platform,
      arch: facts.arch,
    },
    runtime: {
      ...(electron === undefined ? {} : { electron }),
      node,
      ...(chrome === undefined ? {} : { chromium: chrome }),
    },
    license: { notice: [...PRODUCT_LICENSE], ...(delivered ? { thirdParty: THIRD_PARTY_NOTICES } : {}) },
    documentation: {
      ...(delivered ? { bundled: BUNDLED_DOCUMENTATION } : {}),
      online: ONLINE_DOCUMENTATION,
      releases: RELEASES,
    },
  };
};

export default defineCommand({
  name: "tool.info",
  run: async (ctx): Promise<Output> => {
    const [layout, store, build] = await Promise.all([
      ctx.workspace.get(workspaceLayoutState),
      ctx.workspace.get(elementStoreState),
      readBuildInfo(),
    ]);
    const facts = toolFacts(process, build);
    return {
      versions: facts.versions,
      build: facts.build,
      runtime: facts.runtime,
      workspace: {
        path: ctx.workspace.root,
        name: layout.name,
        repositories: layout.repositories.map((repository) => repository.name),
        elements: store.elements.length,
      },
      license: facts.license,
      documentation: facts.documentation,
    };
  },
});
