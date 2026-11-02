// Cross-access scenarios of workspace.status, in addition to the default one (cross-access.test.ts).
import { scenariosOf } from "../../scenario.js";

scenariosOf("workspace.status", [
  { name: "one repository", input: {}, expect: "output" },
  {
    name: "three repositories, one missing",
    fixture: { fixture: "SR-004/three-repositories", git: ["system", "product"], files: {} },
    root: "system",
    input: {},
    expect: "output",
  },
  {
    name: "metamodel missing (read-only)",
    fixture: {
      files: {
        "reqseq-workspace.yaml":
          "reqseq-workspace: 1\nname: No model\nrepositories:\n" +
          '  - { name: main, url: "git@example.com:main.git", main: true }\n' +
          "metamodel: { repository: main, path: model }\n",
      },
      git: true,
    },
    input: {},
    expect: "output",
  },
  { name: "unknown input field", input: { extra: 1 }, expect: "error" },
]);
