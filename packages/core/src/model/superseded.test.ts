import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { Workspace } from "../runtime/workspace.js";
import { supersededTargetProblemsState } from "./superseded.js";

/** Elements of fixtures/SR-072/supersede. */
const N_OLD = "7a1e0c2b-4d3f-4a5b-8c6d-a1b2c3d4e5f6";
const N_NEW = "7a1e0c2b-4d3f-4a5b-8c6d-b2c3d4e5f6a7";
const GADGET = "7a1e0c2b-4d3f-4a5b-8c6d-f6a7b8c9d0e1";
const MISSING = "7a1e0c2b-4d3f-4a5b-8c6d-000000000000";
const MODEL = "metamodel/standard-model.yaml";

const element = (id: string, type: string, status: string, extra = ""): string =>
  `---\nid: ${id}\ntype: ${type}\nstatus: ${status}\ntitle: T\n${extra}---\n`;

const OLD_NEED = element(N_OLD, "need", "obsolete");

/** The hints of the whole workspace for the fixture with `files` written on top. */
const hints = async (files: Readonly<Record<string, string>>): Promise<readonly unknown[]> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-072/supersede", files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace.get(supersededTargetProblemsState);
};

describe("hints on relations to superseded elements (SR-072 AK2)", () => {
  it("[SR-072/AK2] gives no hint when the metamodel marks no status invalid", async () => {
    const model = await fs.readFile(
      new URL(`../../../../fixtures/SR-072/supersede/${MODEL}`, import.meta.url),
      "utf8",
    );
    expect(
      await hints({ [MODEL]: model.replace(", invalid: true", ""), "needs/N-a1b2c3d4e5f6.md": OLD_NEED }),
    ).toEqual([]);
  });

  it("[SR-072/AK2] skips items that are no relation target and targets that are missing or ambiguous", async () => {
    const out = await hints({
      "needs/N-a1b2c3d4e5f6.md": OLD_NEED,
      // A second file with the UUID of the new need makes it ambiguous (SR-088).
      "needs/copy/N-b2c3d4e5f6a7.md": element(N_NEW, "need", "obsolete"),
      "needs/N-b2c3d4e5f6a7.md": element(N_NEW, "need", "obsolete"),
      "requirements/SR-d4e5f6a7b8c9.md": element(
        "7a1e0c2b-4d3f-4a5b-8c6d-d4e5f6a7b8c9",
        "system-requirement",
        "draft",
        `derives-from:\n  - just text\n  - { id: ${MISSING}, version: n1:1111111111111111 }\n  - { id: ${N_NEW}, version: n1:1111111111111111 }\n  - { id: ${N_OLD}, version: n1:1111111111111111 }\nrefines: { id: ${N_OLD}, version: n1:1111111111111111 }\n`,
      ),
    });
    expect(out.map((p) => (p as { file: string; line: number }).file)).toEqual([
      "requirements/SR-c3d4e5f6a7b8.md",
      "requirements/SR-d4e5f6a7b8c9.md",
      "requirements/SR-e5f6a7b8c9d0.md",
    ]);
    expect(out[1]).toMatchObject({ line: 10, targetId: N_OLD });
  });

  it("[SR-072/AK2] names a type the metamodel does not know by its key and lists each successor once", async () => {
    const twice = `  - { id: ${GADGET}, version: n1:1111111111111111 }\n`;
    const out = await hints({
      "requirements/X-f6a7b8c9d0e1.md": element(GADGET, "gadget", "obsolete"),
      "needs/N-b2c3d4e5f6a7.md": element(N_NEW, "need", "draft", `supersedes:\n${twice}${twice}`),
      "needs/N-0a0a0a0a0a0a.md": element(
        "7a1e0c2b-4d3f-4a5b-8c6d-0a0a0a0a0a0a",
        "need",
        "draft",
        `refines:\n  - { id: ${GADGET}, version: n1:1111111111111111 }\n`,
      ),
    });
    expect(out.map((p) => (p as { message: string }).message)).toEqual([
      "Relation Refines (refines) from Need N-0a0a0a points to gadget UNKNOWN-c9d0e1, which is superseded (status Obsolete); successor: Need N-e5f6a7",
      "Relation Supersedes (supersedes) from Need N-e5f6a7 points to gadget UNKNOWN-c9d0e1, which is superseded (status Obsolete)",
      "Relation Supersedes (supersedes) from Need N-e5f6a7 points to gadget UNKNOWN-c9d0e1, which is superseded (status Obsolete)",
    ]);
  });

  it("[SR-072/AK2] says successors when there are several", async () => {
    const supersedes = `supersedes:\n  - { id: ${N_OLD}, version: n1:1111111111111111 }\n`;
    const out = await hints({
      "needs/N-a1b2c3d4e5f6.md": OLD_NEED,
      "needs/N-b2c3d4e5f6a7.md": element(N_NEW, "need", "draft", supersedes),
      "needs/N-0a0a0a0a0a0a.md": element("7a1e0c2b-4d3f-4a5b-8c6d-0a0a0a0a0a0a", "need", "draft", supersedes),
    });
    expect(out.map((p) => (p as { message: string }).message)).toEqual([
      "Relation Supersedes (supersedes) from Need N-0a0a0a points to Need N-d4e5f6, which is superseded (status Obsolete); successor: Need N-e5f6a7",
      "Relation Supersedes (supersedes) from Need N-e5f6a7 points to Need N-d4e5f6, which is superseded (status Obsolete); successor: Need N-0a0a0a",
      "Relation Derives from (derives-from) from System Requirement SR-f6a7b8 points to Need N-d4e5f6, which is superseded (status Obsolete); successors: Need N-0a0a0a, Need N-e5f6a7",
      "Relation Derives from (derives-from) from System Requirement SR-b8c9d0 points to Need N-d4e5f6, which is superseded (status Obsolete); successors: Need N-0a0a0a, Need N-e5f6a7",
    ]);
  });
});
