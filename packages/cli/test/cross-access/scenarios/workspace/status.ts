// Cross-access scenarios of workspace.status, in addition to the default one (cross-access.test.ts).
import { expect } from "vitest";
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
    // SR-215: the folder of each location as evidence.record takes it, none for an unlisted repository.
    name: "evidence locations in the main repository, its root, another repository and an unlisted one",
    fixture: {
      fixture: "SR-004/three-repositories",
      git: ["system", "product"],
      files: {
        "system/reqseq-workspace.yaml":
          "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
          '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
          '  - { name: product, url: "git@git.example.com:ws/product.git" }\n' +
          "metamodel: { repository: system, path: metamodel }\n" +
          "evidence:\n  - { repository: system, path: evidence }\n  - { repository: system, path: . }\n" +
          "  - { repository: product, path: tests/results }\n  - { repository: elsewhere, path: tests }\n",
      },
    },
    root: "system",
    input: {},
    expect: "output",
    check: (results) => {
      for (const [access, { outcome }] of Object.entries(results)) {
        const { evidence } = (outcome as { output: { evidence: { folder?: string }[] } }).output;
        expect(
          evidence.map((location) => location.folder),
          access,
        ).toEqual(["evidence", ".", "../product/tests/results", undefined]);
      }
    },
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
  {
    // The mark only; the status AK1 asks for is the evidence.status scenario of SR-173 AK1.
    name: "a repository marked variant-independent (SR-173)",
    fixture: { fixture: "SR-173/independent", git: true },
    input: {},
    expect: "output",
  },
  {
    // Committed with the fixture: every access ignores it with the same warning (#1456).
    name: "a local file tracked by Git",
    tag: "[SR-004/AK-m7c2]",
    fixture: {
      fixture: "SR-004/one-repository",
      git: true,
      files: { ".reqseq/local.yaml": "reqseq-local: 1\n" },
    },
    input: {},
    expect: "output",
    check: (results) => {
      const problems =
        (results["core"]?.outcome as { output?: { problems?: { file?: string; message: string }[] } }).output
          ?.problems ?? [];
      expect(problems.filter((p) => p.file === ".reqseq/local.yaml").map((p) => p.message)).toEqual([
        expect.stringContaining("is tracked by Git"),
      ]);
    },
  },
  { name: "unknown input field", input: { extra: 1 }, expect: "error" },
]);
