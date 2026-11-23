// tool.info (SR-161): the version of the command line and the MCP server, the build, the runtime
// and the open workspace in one place, read only (AK1); the licence notice, the third-party licences and
// where the documentation and the releases are, as text only: no network connection (AK2, SR-077). One
// delivery ships command line, MCP server and web UI with one version (AK4, ADR-0020). The runtime is the
// process's: the delivered command line, API, MCP server and UI server all run on the Node of the delivery, so
// every access gives the same values (AK5). The files of a delivery exist only there, so they are named only with
// its build info.
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import type { BuildInfo } from "../../build-info.js";
import { readBuildInfo } from "../../build-info.js";
import { elementStoreState } from "../../model/index.js";
import { PRODUCT_LICENSE, PRODUCT_VERSION } from "../../product.js";
import { workspaceLayoutState } from "../../workspace/index.js";
import { counted, sentence } from "../answer.js";

type Output = CommandOutput<"tool.info">;

/** The addresses the info names as text only; ReqSeq never opens them. */
export const ONLINE_DOCUMENTATION = "https://thomasbirkmaier.github.io/ReqSeq/";
export const RELEASES = "https://github.com/ThomasBirkmaier/ReqSeq/releases";

/** In a delivery, relative to its folder (ADR-0020); the documentation site is `docs/` of the CLI in `lib/` (SR-141). */
export const THIRD_PARTY_NOTICES = "THIRD_PARTY_NOTICES.txt";
export const BUNDLED_DOCUMENTATION = "lib/docs";

/** What the process tells about itself: the parts of `process` the info reads. */
export interface ProcessFacts {
  readonly versions: { readonly node: string };
  readonly platform: string;
  readonly arch: string;
}

/** The output without the workspace, from the facts of the process and the build info (if any). */
export const toolFacts = (facts: ProcessFacts, build: BuildInfo | undefined): Omit<Output, "workspace"> => {
  const delivered = build !== undefined;
  return {
    versions: { cli: PRODUCT_VERSION, mcp: PRODUCT_VERSION },
    build: {
      ...(delivered ? { commit: build.commit, date: build.date } : { development: true as const }),
      platform: facts.platform,
      arch: facts.arch,
    },
    runtime: { node: facts.versions.node },
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
  answer: (output) =>
    sentence(
      `ReqSeq ${output.versions.cli} with workspace ${output.workspace.name}: ${counted(output.workspace.repositories.length, "repository", "repositories")} and ${counted(output.workspace.elements, "element")}`,
    ),
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
  // The elements `workspace.elements` counts (SR-224 AK4): every element of the store, in no view.
  countedElements: async (ctx) => ({
    elements: (await ctx.workspace.get(elementStoreState)).elements,
    incomplete: false,
  }),
});
