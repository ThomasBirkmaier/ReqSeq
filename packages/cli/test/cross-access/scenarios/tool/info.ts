// Cross-access scenarios of tool.info, in addition to the default one (cross-access.test.ts).
import { scenariosOf } from "../../scenario.js";

scenariosOf("tool.info", [
  { name: "versions, build and the open workspace", tag: "[SR-161/AK-r14d]", input: {}, expect: "output" },
]);
