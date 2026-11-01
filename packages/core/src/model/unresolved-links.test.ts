import { readFile } from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { Problem } from "../catalog.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { metamodelState } from "../metamodel/index.js";
import type { ElementRecord } from "./elements.js";
import type { ShortIds } from "./short-id.js";
import { shortIdState } from "./short-id.js";
import { elementStoreState } from "./store.js";
import { unresolvedLinkProblems, unresolvedLinkProblemsState } from "./unresolved-links.js";

const SOURCE = "requirements/SR-3d8b2c6e1f05.md";
/** Two copies of the variant's UUID make its short ID ambiguous (SR-088). */
const COPY = "variants/copy-of-VAR.md";
const VAR = "9d4e6a1b-3c2f-4b8a-a1d7-52e8c0f4b9a3";

const problemsOf = async (files: Record<string, string>): Promise<readonly Problem[]> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-021/targets", files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.path("system"));
  onTestFinished(() => workspace.close());
  return workspace.get(unresolvedLinkProblemsState);
};

const source = (frontmatter: string, text: string): string =>
  `---\nid: 6e2f8a4c-1b3d-4c5e-9f7a-3d8b2c6e1f05\ntype: system-requirement\nstatus: draft\ntitle: Show wind speed\n${frontmatter}---\n\n${text}`;

describe("reqseq: links whose target is no UUID (#176)", () => {
  it("reports each stored one that counts as a warning with its line, saying what it names", async () => {
    const problems = await problemsOf({
      [`system/${SOURCE}`]: source(
        [
          "rationale: Like [the need](reqseq:N-1f2a4c).",
          "acceptance-criteria:",
          "  - Given [copies](reqseq:VAR-f4b9a3).",
          "topic: Not marked [x](reqseq:N-1f2a4c).",
          "",
        ].join("\n"),
        "See [gone](reqseq:N-000000).\n",
      ),
      [`system/${COPY}`]: `---\nid: ${VAR}\ntype: variant\nstatus: draft\ntitle: Pro\n---\n`,
    });
    const at = { repository: "system", file: SOURCE, elementId: "6e2f8a4c-1b3d-4c5e-9f7a-3d8b2c6e1f05" };
    expect(problems).toEqual([
      {
        code: "relation.unresolved-link",
        severity: "warning",
        message:
          "The link reqseq:N-1f2a4c in rationale of System Requirement SR-6e1f05 does not name its target by a UUID in lower case, so it counts for nothing: it names Need N-1f2a4c; give the property rationale again with element update, which writes reqseq:<uuid>?version=…",
        line: 6,
        ...at,
      },
      {
        code: "relation.unresolved-link",
        severity: "warning",
        message:
          "The link reqseq:VAR-f4b9a3 in acceptance-criteria (item 1) of System Requirement SR-6e1f05 does not name its target by a UUID in lower case, so it counts for nothing: it names more than one element; write the UUID of the one it means",
        line: 8,
        ...at,
      },
      {
        code: "relation.unresolved-link",
        severity: "warning",
        message:
          "The link reqseq:N-000000 in the text of System Requirement SR-6e1f05 does not name its target by a UUID in lower case, so it counts for nothing: it names no element; point it to an element by its UUID, short ID or identifier",
        line: 12,
        ...at,
      },
    ]);
  });

  it("resolves the target within the repository the link names, as the writer does, and says when copies need repository=", async () => {
    const need = await readFile(
      new URL("../../../../fixtures/SR-021/targets/system/needs/N-7b3d5e1f2a4c.md", import.meta.url),
      "utf8",
    );
    const messages = (problems: readonly Problem[]): string[] =>
      problems.map((p) => p.message.slice(p.message.indexOf("counts for nothing: ") + 20));
    expect(
      messages(
        await problemsOf({
          [`system/${SOURCE}`]: source(
            "",
            "See [n](reqseq:N-1f2a4c?repository=sensor) and [u](reqseq:0C8A3E5F-2D1B-4F6E-8A9C-7B3D5E1F2A4C).\n",
          ),
        }),
      ),
    ).toEqual([
      "it names no element in repository sensor; point it to an element by its UUID, short ID or identifier",
      "it names Need N-1f2a4c; give the text again with element update, which writes reqseq:<uuid>?version=…",
    ]);
    expect(
      messages(
        await problemsOf({
          [`system/${SOURCE}`]: source(
            "",
            "See [a](reqseq:N-1f2a4c) and [b](reqseq:N-1f2a4c?repository=system).\n",
          ),
          "sensor/needs/N-7b3d5e1f2a4c.md": need,
        }),
      ),
    ).toEqual([
      "its UUID lies in several repositories; add repository=<name> to the link (system, sensor)",
      "it names Need N-1f2a4c; give the text again with element update, which writes reqseq:<uuid>?version=…",
    ]);
  });

  it("reports none for a workspace without such links, and none against a metamodel that is not valid", async () => {
    expect(await problemsOf({})).toEqual([]);
    expect(
      await problemsOf({
        [`system/${SOURCE}`]: source("", "See [gone](reqseq:N-000000).\n"),
        "system/metamodel/standard-model.yaml": "types: [",
      }),
    ).toEqual([]);
  });

  it("names an element of an unknown type by its key and with its identifier", async () => {
    const fixture = await createFixtureWorkspace({ fixture: "SR-021/targets" });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.path("system"));
    onTestFinished(() => workspace.close());
    const store = await workspace.get(elementStoreState);
    const metamodel = await workspace.get(metamodelState);
    const real = await workspace.get(shortIdState);
    const [first] = store.elements;
    if (first === undefined) {
      throw new Error("no element");
    }
    const element: ElementRecord = {
      ...first,
      type: "gadget",
      unresolvedLinks: [{ target: "N-1f2a4c", line: 7 }],
    };
    const shortIds: ShortIds = { ...real, identifierOf: () => "G-1" };
    const [problem] = unresolvedLinkProblems(element, { store, metamodel, shortIds });
    expect(problem?.message).toMatch(/ in the text of gadget \S+ \(G-1\) /);
    expect(problem?.message).toContain("it names Need N-1f2a4c (G-1)");
  });

  it("shows the hint at the element and lists it in hint.list, as workspace.check gives it", async () => {
    const fixture = await createFixtureWorkspace({
      fixture: "SR-021/targets",
      files: { [`system/${SOURCE}`]: source("", "See [the need](reqseq:N-1f2a4c).\n") },
    });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.path("system"));
    onTestFinished(() => workspace.close());
    const shown = (await invoke("element.get", { ref: "SR-6e1f05" }, { workspace })) as {
      readonly element: { readonly problems: readonly Problem[] };
    };
    const listed = (await invoke("hint.list", {}, { workspace })) as { readonly hints: readonly Problem[] };
    const check = (await invoke("workspace.check", {}, { workspace })) as {
      readonly problems: readonly Problem[];
    };
    const found = check.problems.filter((p) => p.code === "relation.unresolved-link");
    expect(found).toMatchObject([{ line: 8, elementId: "6e2f8a4c-1b3d-4c5e-9f7a-3d8b2c6e1f05" }]);
    expect(shown.element.problems.filter((p) => p.code === "relation.unresolved-link")).toEqual(found);
    expect(listed.hints.filter((p) => p.code === "relation.unresolved-link")).toEqual(found);
  });
});

describe("reqseq: references outside a Markdown link (#633)", () => {
  it("[SR-021/AK3] warns through workspace.check with file and line about one in the text outside links and code", async () => {
    const fixture = await createFixtureWorkspace({
      fixture: "SR-021/targets",
      files: {
        [`system/${SOURCE}`]: source(
          "rationale: Like reqseq:N-1f2a4c in a property.\n",
          [
            "Confirms:",
            "",
            "- reqseq:N-1f2a4c",
            "- <reqseq:N-000000>, a link: [the need](reqseq:N-1f2a4c), [reqseq:N-1f2a4c](reqseq:N-1f2a4c)",
            "- in code: `reqseq:N-1f2a4c`",
            "",
            "```",
            "reqseq:N-1f2a4c",
            "```",
            "",
            "    reqseq:N-1f2a4c",
            "",
            "[def]: reqseq:N-1f2a4c",
            "",
          ].join("\n"),
        ),
      },
    });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.path("system"));
    onTestFinished(() => workspace.close());
    const check = (await invoke("workspace.check", {}, { workspace })) as {
      readonly ok: boolean;
      readonly problems: readonly Problem[];
    };
    const at = {
      repository: "system",
      file: SOURCE,
      elementId: "6e2f8a4c-1b3d-4c5e-9f7a-3d8b2c6e1f05",
      elementShortId: "SR-6e1f05",
    };
    expect(check.ok).toBe(true);
    expect(check.problems.filter((p) => p.code === "relation.not-a-link")).toEqual([
      {
        code: "relation.not-a-link",
        severity: "warning",
        message:
          "The text of System Requirement SR-6e1f05 names reqseq:N-1f2a4c outside a Markdown link, so it counts for nothing (no relation, no outdated check, no trace): write it as a link, [Title](reqseq:N-1f2a4c), or put it in code if it is no reference",
        line: 11,
        ...at,
      },
      {
        code: "relation.not-a-link",
        severity: "warning",
        message:
          "The text of System Requirement SR-6e1f05 names reqseq:N-000000 outside a Markdown link, so it counts for nothing (no relation, no outdated check, no trace): write it as a link, [Title](reqseq:N-000000), or put it in code if it is no reference",
        line: 12,
        ...at,
      },
    ]);
    const shown = (await invoke("element.get", { ref: "SR-6e1f05" }, { workspace })) as {
      readonly element: { readonly problems: readonly Problem[] };
    };
    expect(shown.element.problems.filter((p) => p.code === "relation.not-a-link")).toHaveLength(2);
  });

  it("reports them after the unresolved links of the element, and alone when it has none", async () => {
    const codes = (problems: readonly Problem[]): string[] =>
      problems.map((p) => `${p.code}:${String(p.line)}`);
    expect(
      codes(
        await problemsOf({
          [`system/${SOURCE}`]: source("", "reqseq:N-1f2a4c and [gone](reqseq:N-000000).\n"),
        }),
      ),
    ).toEqual(["relation.unresolved-link:8", "relation.not-a-link:8"]);
    expect(codes(await problemsOf({ [`system/${SOURCE}`]: source("", "Only reqseq:N-1f2a4c.\n") }))).toEqual([
      "relation.not-a-link:8",
    ]);
  });
});
