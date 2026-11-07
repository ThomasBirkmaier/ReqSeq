// Cross-access scenarios of workspace.listFolder, in addition to the default one (cross-access.test.ts).
// A relative path is resolved from the workspace root on every access, the command line included (the
// path is a plain text, not a `localPath`). A folder outside the repositories is refused through the API
// and the MCP server and listed on the command line (SR-142), so that case is in local-paths.test.ts.
import { scenariosOf } from "../../scenario.js";

scenariosOf("workspace.listFolder", [
  {
    name: "the folders and files of the workspace root, as typed in a file argument",
    input: { path: "re", files: true },
    expect: "output",
  },
  {
    name: "the folders of a folder below the root, without its files",
    input: { path: "requirements/" },
    expect: "output",
  },
  {
    name: "a folder that is missing",
    input: { path: "gone/x" },
    expect: "output",
  },
  {
    name: "a relative path refused by its text when an absolute one is asked for",
    input: { path: "requirements/", absolute: true },
    expect: "output",
  },
]);
