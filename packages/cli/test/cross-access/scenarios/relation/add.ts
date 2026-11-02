// Cross-access scenarios of relation.add, in addition to the default one (cross-access.test.ts).
import { scenariosOf } from "../../scenario.js";

scenariosOf("relation.add", [
  {
    name: "a derivation that closes a cycle, with hints (SR-067 AK3)",
    fixture: { fixture: "SR-090/cycle", git: true },
    input: {
      source: "SR-b0000000001",
      kind: "derives-from",
      target: "5e9c0a7d-2b4f-4c61-9d08-0b0000000004",
    },
    expect: "output",
  },
  {
    name: "a relation across repositories (SR-005)",
    fixture: { fixture: "SR-021/targets", git: ["system", "sensor"] },
    root: "system",
    input: {
      source: "6e2f8a4c-1b3d-4c5e-9f7a-3d8b2c6e1f05",
      kind: "derives-from",
      target: "a7f3c1e9-5b2d-4e8f-b6a4-0e9d7c5b3a21",
    },
    expect: "output",
  },
  {
    name: "a relation the metamodel does not allow",
    fixture: { fixture: "SR-090/cycle", git: true },
    input: { source: "N-a0000000001", kind: "derives-from", target: "SR-b0000000001" },
    expect: "error",
  },
  {
    name: "a stored relation without version gets its current version (#302)",
    fixture: {
      fixture: "SR-090/cycle",
      git: true,
      files: {
        "requirements/SR-0b0000000004.md":
          "---\nid: 5e9c0a7d-2b4f-4c61-9d08-0b0000000004\ntype: system-requirement\nstatus: draft\n" +
          "title: Show wind in large digits\nrequirement-type: functional\n" +
          "acceptance-criteria:\n  - Given wind, when it is measured, then the station shows it in large digits.\n" +
          'derives-from:\n  - { id: 5e9c0a7d-2b4f-4c61-9d08-0b0000000001, title: "Migrated" }\n---\n\nD.\n',
      },
    },
    input: { source: "SR-b0000000004", kind: "derives-from", target: "SR-b0000000001" },
    expect: "output",
  },
]);
