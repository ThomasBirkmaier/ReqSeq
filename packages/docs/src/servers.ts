// The page of the three commands outside the catalog that start a server: `reqseq serve api`, `reqseq serve docs`
// and `reqseq mcp` (SR-139). Their text is the CLI's own `--help`, as on the command pages, so it cannot go stale.
import { COMMANDS_PATH } from "@reqseq/api";
import type { CommandRuntime } from "@reqseq/core";
import { COMMANDS_FOLDER } from "@reqseq/core/docs-site";
import { cliOutput } from "./access.js";
import { codeBlock } from "./markdown.js";

/** The path of the page in the content folder, in the sidebar's Commands section. */
export const SERVERS_PAGE = `${COMMANDS_FOLDER}/servers.md`;

/** The server commands, in the order of the page, with what each one is for. */
export const SERVERS: readonly {
  readonly argv: readonly string[];
  readonly purpose: (root: string) => string;
}[] = [
  {
    argv: ["serve", "api"],
    purpose: (root) =>
      `Runs the local API of one workspace for other programs on the same computer. \`GET ${COMMANDS_PATH}\` lists the commands, \`POST ${COMMANDS_PATH}/<name>\` runs one, with its input as the JSON body. The port and the token are in the [API endpoint file](${root}/reference/formats/api-endpoint/).`,
  },
  {
    argv: ["serve", "docs"],
    purpose: () =>
      "Serves this documentation of the installed ReqSeq version, to read and search in a browser without network.",
  },
  {
    argv: ["mcp"],
    purpose: () => "Runs the MCP server of one workspace for an AI assistant, with one tool per command.",
  },
];

/** The page; `order` places it in the sidebar, links start with the site's `base`. */
export async function serversPage(runtime: CommandRuntime, base: string, order: number): Promise<string> {
  const root = base.replace(/\/$/, "");
  const sections: string[] = [];
  for (const server of SERVERS) {
    const call = ["reqseq", ...server.argv].join(" ");
    sections.push(
      `## ${call}`,
      "",
      server.purpose(root),
      "",
      "Its help:",
      "",
      codeBlock(await cliOutput([...server.argv, "--help"], runtime)),
      "",
    );
  }
  return [
    "---",
    "title: Servers",
    'description: "The commands that start the local API, the offline documentation and the MCP server."',
    "sidebar:",
    `  order: ${String(order)}`,
    "---",
    "",
    "Three commands of the command line start a server instead of running one command. They run until Ctrl-C, and `reqseq mcp` also ends with its input.",
    `How the API and MCP find the workspace, take input and report errors: [CLI, API and MCP](${root}/concepts/cli-api-and-mcp/).`,
    "",
    ...sections,
  ].join("\n");
}
