import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as core from "../../packages/core/src/index.ts";
import {
  buildWorkspace,
  elementPath,
  fillWithLogReq,
  linkMentions,
  parseExportFile,
  readExport,
  ringPartners,
  STAGES,
  targetsFirst,
  unlink,
  verifyVerbatim,
  writeFiles,
} from "./convert.mjs";

const folders = [];
afterEach(() => {
  for (const f of folders.splice(0)) {
    fs.rmSync(f, { recursive: true, force: true });
  }
});
const temp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "logreq-spec-migrate-"));
  folders.push(dir);
  return dir;
};

// Built at run time, so that trace-check does not read this file as tests of real SRs.
const example = `[${"N-001"}/AK2]`;

const U = {
  n1: "6ad39e3c-c38c-42ed-bcdf-357251b79fe2",
  n2: "6ad39e3d-0000-4000-8000-000000000002",
  sr1: "6adc6c48-4fce-40e6-aca6-5a8b253c90b0",
  d1: "6adc0001-0000-4000-8000-000000000001",
  d2: "6adc0002-0000-4000-8000-000000000002",
  d3: "6adc0003-0000-4000-8000-000000000003",
  g1: "6ad4f981-8c70-4568-a77a-3da4cd2f98ac",
  g2: "6ad4f983-347f-45f1-9e4e-5223b02f876f",
};

/** A small export in the preliminary format of the spec-export skill. */
function exportDir() {
  const dir = temp();
  const files = {
    "needs/N-001.md": `---\nid: "N-001"\nuuid: "${U.n1}"\ntype: "need"\ntitle: "Requirement nur an einer Stelle"\nre_status: "Draft"\nthema: "Anbindung und Auswertung"\n---\n\nEin Requirement existiert nur an einer Stelle (D-001).\n`,
    "needs/N-002.md": `---\nid: "N-002"\nuuid: "${U.n2}"\ntype: "need"\ntitle: "Alt"\nre_status: "Obsolete"\n---\n\nAbgelöst durch N-001; N-002 selbst.\n`,
    "system-requirements/SR-001.md": [
      "---",
      'id: "SR-001"',
      `uuid: "${U.sr1}"`,
      'type: "system-requirement"',
      'title: "Abdeckung einer Auswahl berechnen"',
      "akzeptanzkriterien:",
      '  - "Gegeben eine Auswahl (N-001), dann \\"zählt\\" es."',
      "based_on:",
      '  - "D-001"',
      "derives_from:",
      '  - "N-001"',
      'nachweismethode: "Test"',
      'rationale: "Weil."',
      're_status: "Draft"',
      'requirement_type: "Functional"',
      'thema: "Nachweis und Abdeckung"',
      "---",
      "",
      `Das Tool muss rechnen (D-001, D-003), siehe \`D-002\` und ${example}.`,
      "",
      "```",
      "D-002 im Code",
      "```",
      "",
    ].join("\n"),
    "decisions/D-001.md": `---\nid: "D-001"\nuuid: "${U.d1}"\ntype: "decision"\ntitle: "Eins"\ndecision_status: "Superseded"\n---\n\nRing mit D-002.\n`,
    "decisions/D-002.md": `---\nid: "D-002"\nuuid: "${U.d2}"\ntype: "decision"\ntitle: "Zwei"\ndecision_status: "Accepted"\nsupersedes:\n  - "D-001"\n---\n\nRing mit D-001, Verweis auf D-003 und [Link](https://example.org) D-003.\n`,
    "decisions/D-003.md": `---\nid: "D-003"\nuuid: "${U.d3}"\ntype: "decision"\ntitle: "Drei"\ndecision_status: "Accepted"\n---\n\nKein Verweis.`,
    "glossary/baseline.md": `---\nuuid: "${U.g1}"\ntype: "glossary-term"\ntitle: "Baseline"\nbereich: "Fachlich"\noberbegriff: "Kern"\nsynonyme:\n  - "Stand"\nnicht_verwenden: true\n---\n\nBenannter Stand (D-003).\n`,
    "glossary/kern.md": `---\nuuid: "${U.g2}"\ntype: "glossary-term"\ntitle: "Kern"\nbereich: "Tool-Entwicklung"\nabgrenzung:\n  - "Baseline"\nsiehe_auch:\n  - "Baseline"\n---\n`,
    "stages.json": JSON.stringify({ 3: ["SR-001"] }),
  };
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

const read = (dir, type, uuid) => fs.readFileSync(path.join(dir, elementPath(type, uuid)), "utf8");

describe("spec migration (Logseq export -> LogReq workspace, #326)", () => {
  it("converts an export into a workspace that LogReq checks without findings beyond the known ones", async () => {
    const exp = readExport(exportDir());
    const plan = buildWorkspace(exp);
    expect(plan.problems).toEqual([]);
    const ws = path.join(temp(), "spec");
    writeFiles(ws, plan.files);
    const result = await fillWithLogReq(ws, plan, core);
    expect(verifyVerbatim(ws, exp)).toEqual([]);

    // Spec IDs are identifiers, statuses follow the types, packages come from stages.json.
    const workspace = new core.Workspace(ws);
    try {
      const sr = (await core.invoke("element.get", { ref: "SR-001" }, { workspace })).element;
      expect(sr).toMatchObject({
        id: U.sr1,
        identifier: "SR-001",
        status: "draft",
        file: elementPath("system-requirement", U.sr1),
      });
      expect(sr.properties).toMatchObject({
        "requirement-type": "functional",
        "verification-method": "test",
        rationale: "Weil.",
        topic: "Nachweis und Abdeckung",
        "acceptance-criteria": ['Gegeben eine Auswahl (N-001), dann "zählt" es.'],
      });
      const stage3 = STAGES.find((s) => s.key === "3");
      expect(
        sr.relations.map((rel) => [rel.kind, rel.identifier, /^n1:[0-9a-f]{16}$/.test(rel.storedVersion)]),
      ).toEqual([
        ["derives-from", "N-001", true],
        ["based-on", "D-001", true],
        ["packages", "Stufe-3", true],
      ]);
      expect((await core.invoke("element.get", { ref: "Stufe-3" }, { workspace })).element.id).toBe(
        stage3.id,
      );
      const status = async (ref) => (await core.invoke("element.get", { ref }, { workspace })).element.status;
      expect([
        await status("N-002"),
        await status("D-001"),
        await status("D-002"),
        await status("Stufe-3"),
      ]).toEqual(["obsolete", "superseded", "accepted", "draft"]);
      const term = (await core.invoke("element.get", { ref: U.g1 }, { workspace })).element;
      expect(term.status).toBeUndefined();
      expect(term.properties).toMatchObject({
        area: "fachlich",
        synonyms: ["Stand"],
        "do-not-use": "yes",
      });
    } finally {
      await workspace.close();
    }

    // Links: everything but rings, self mentions, code and the test-name example.
    expect(read(ws, "system-requirement", U.sr1)).toMatch(
      new RegExp(
        `\\(\\[D-001\\]\\(logreq:${U.d1}\\?version=n1:[0-9a-f]{16}\\), \\[D-003\\]\\(logreq:${U.d3}\\?version=n1:[0-9a-f]{16}\\)\\), siehe \`D-002\` und \\[N-001/AK2\\]\\.\\n\\n\`\`\`\\nD-002 im Code\\n\`\`\`\\n$`,
      ),
    );
    expect(read(ws, "decision", U.d2)).toContain("Ring mit D-001, Verweis auf [D-003](logreq:");
    expect(read(ws, "decision", U.d1)).toContain("Ring mit D-002.");
    expect(read(ws, "need", U.n2)).toMatch(/Abgelöst durch \[N-001\]\(logreq:[^)]+\); N-002 selbst\.\n$/);
    expect(read(ws, "decision", U.d3)).toBe(
      `---\nid: ${U.d3}\ntype: decision\nstatus: accepted\ntitle: "Drei"\nspec-id: "D-003"\n---\n\nKein Verweis.\n`,
    );
    expect(read(ws, "glossary-term", U.g2)).toMatch(
      /^---\nid: .*\ntype: glossary-term\ntitle: "Kern"\narea: tool-entwicklung\ndistinct-from:\n {2}- \{ id: 6ad4f981-8c70-4568-a77a-3da4cd2f98ac, version: n1:[0-9a-f]{16}, title: .*\}\nsee-also:\n/,
    );
    expect(plan.stats).toMatchObject({
      self: 1,
      example: 1,
      ring: ["D-001 -> D-002", "D-002 -> D-001"],
      inProperties: 1,
    });

    // Every relation got its version from LogReq and nothing is outdated. The warnings are the relations
    // to the superseded D-001: SR-001 is based on it, and D-002's own supersedes relation (#304).
    expect(result.confirmed).toBe(0);
    expect(result.versionsAdded).toBe(plan.relations.length);
    expect(result.check.ok).toBe(true);
    expect(result.check.problems.map((p) => p.code)).toEqual([
      "metamodel.invalid",
      "relation.target-superseded",
      "relation.target-superseded",
    ]);
  });

  it("never writes into a folder that is not empty", () => {
    const dir = temp();
    fs.writeFileSync(path.join(dir, "x.md"), "x");
    expect(() => writeFiles(dir, new Map([["y.md", "y"]]))).toThrow(/is not empty/);
  });

  it("reports what it cannot map, and writes nothing then", () => {
    const parse = (rel, text) => parseExportFile(text, rel);
    const plan = buildWorkspace({
      elements: [
        parse(
          "a",
          `---\nid: "SR-009"\nuuid: "${U.sr1}"\ntype: "system-requirement"\ntitle: "T"\nre_status: "Approved"\nnachweismethode: "Raten"\nfarbe: "rot"\nderives_from:\n  - "N-404"\n---\n`,
        ),
        parse(
          "b",
          `---\nuuid: "${U.g1}"\ntype: "glossary-term"\ntitle: "G"\nbereich: "Anders"\noberbegriff: "Fehlt"\nnicht_verwenden: "true"\n---\n\nText ohne Zeilenende (N-404)`,
        ),
      ],
      stages: { 9: [] },
    });
    expect(plan.problems).toEqual([
      "stages.json: stage 9 has no package",
      "SR-009: key farbe is not mapped",
      "SR-009: status Approved has no key for system-requirement",
      "SR-009: verification-method Raten has no choice key",
      "SR-009: no stage in stages.json",
      "SR-009: derives-from target N-404 not found",
      "G: area Anders has no choice key",
      "G: do-not-use true has no choice key",
      "G: broader-term target Fehlt not found",
    ]);
    // The stage texts name D-035, which this export does not have.
    expect(plan.stats.unknown).toEqual(["?: N-404", ...[1, 2, 3, 4, 5, 6].map((n) => `Stufe-${n}: D-035`)]);
    expect(() => parseExportFile("no frontmatter", "x.md")).toThrow(/no frontmatter: x.md/);
    expect(() => parseExportFile("---\n  - orphan\n---\n", "y.md")).toThrow(/cannot read line in y.md/);
  });

  it("finds rings and orders targets first", () => {
    const graph = new Map([
      ["a", new Set(["b"])],
      ["b", new Set(["a", "c"])],
      ["c", new Set()],
    ]);
    const rings = ringPartners(graph);
    expect([...rings.keys()].sort()).toEqual(["a", "b"]);
    expect(rings.has("c")).toBe(false);
    const order = targetsFirst(
      new Map([
        ["a", new Set(["c"])],
        ["c", new Set()],
        ["d", new Set(["a"])],
      ]),
    );
    expect(order).toEqual(["c", "a", "d"]);
  });

  it("keeps the text when the link markup is taken out again", () => {
    const stats = { linked: 0, self: 0, example: 0, unknown: [], ring: [] };
    const text = "Siehe (D-001) und `D-001` und [D-001](https://x) und D-0012.\n";
    const linked = linkMentions(text, "N-001", new Map([["D-001", U.d1]]), stats);
    expect(linked).toBe(`Siehe ([D-001](logreq:${U.d1})) und \`D-001\` und [D-001](https://x) und D-0012.\n`);
    expect(unlink(linked)).toBe(text);
    expect(stats.linked).toBe(1);
  });
});
