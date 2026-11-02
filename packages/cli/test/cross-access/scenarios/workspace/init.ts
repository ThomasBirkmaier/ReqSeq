// Cross-access scenarios of workspace.init, in addition to the default one (cross-access.test.ts).
import { scenariosOf } from "../../scenario.js";

// `path` is a localPath: the CLI makes it absolute from its current folder (the root here), API and MCP
// take it relative to the root, so all four write into the same folder of their copy.
scenariosOf("workspace.init", [
  {
    name: "new folder",
    fixture: { files: { "new/.keep": "" } },
    input: { path: "new", name: "New" },
    expect: "output",
  },
  {
    name: "root of call",
    fixture: { files: { ".keep": "" } },
    input: { path: ".", name: "New" },
    expect: "output",
  },
  { name: "existing workspace", input: { path: ".", name: "Again" }, expect: "error" },
]);
