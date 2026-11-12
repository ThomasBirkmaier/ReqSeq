// Cross-access scenarios of tool.info, in addition to the default one (cross-access.test.ts). The runtime
// of the app's own process against the delivered command line and MCP server on Electron is the Electron
// test `tool-info.spec.ts` (SR-161 AK5).
import { scenariosOf } from "../../scenario.js";

scenariosOf("tool.info", [
  { name: "versions, build and the open workspace", tag: "[SR-161/AK-r14d]", input: {}, expect: "output" },
]);
