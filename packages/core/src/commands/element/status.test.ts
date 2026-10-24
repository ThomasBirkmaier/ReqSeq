// ADR-0002 rule 6 (D-030, SR-087): only element.setStatus and element.supersede change a status.
// element.create and element.update run on a workspace with existing elements of several statuses;
// afterwards every existing element has the status it had.
import { createFixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { elementStoreState } from "../../model/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

const WIND = "e8df96ea-a168-4d90-8d65-6328cee88fb3";
const GUSTS = "3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c";
const OBSOLETE = "0b7c6e1a-1111-4222-8333-444455556666";

describe("element.create and element.update never change a status (ADR-0002 rule 6)", () => {
  it("keeps the status of every existing element", async () => {
    const fixture = await createFixtureWorkspace({
      fixture: "SR-001/two-elements",
      files: {
        "requirements/SR-444455556666.md": `---\nid: ${OBSOLETE}\ntype: system-requirement\nstatus: obsolete\ntitle: Old\n---\n`,
        "needs/N-aaaaaaaaaaaa.md": `---\nid: 0b7c6e1a-1111-4222-8333-aaaaaaaaaaaa\ntype: need\nstatus: approved\ntitle: Need\n---\n`,
      },
    });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    const statuses = async (): Promise<Map<string, unknown>> =>
      new Map((await workspace.get(elementStoreState)).elements.map((e) => [e.id, e.data["status"]]));
    const before = await statuses();
    expect([...before.values()]).toEqual(["approved", "draft", "obsolete", "draft"]);

    const created: string[] = [];
    for (const type of ["need", "system-requirement", "decision"]) {
      const out = (await invoke(
        "element.create",
        { type, title: `New ${type}`, folder: "needs" },
        { workspace },
      )) as {
        element: { id: string; status: string };
      };
      expect(out.element.status).toBe("draft");
      created.push(out.element.id);
    }
    const updates: Record<string, unknown>[] = [
      { ref: WIND, title: "Renamed" },
      { ref: GUSTS, text: "New text\n", set: { rationale: "Why", "requirement-type": "quality" } },
      { ref: GUSTS, unset: ["acceptance-criteria", "rationale"] },
      { ref: OBSOLETE, title: "Still old", set: { "verification-method": "test" } },
      { ref: "N-aaaaaa", title: "Need", text: "unchanged status\n" },
    ];
    for (const input of updates) {
      await invoke("element.update", input, { workspace });
    }

    const after = await statuses();
    for (const [id, status] of before) {
      expect([id, after.get(id)]).toEqual([id, status]);
    }
    expect(created.map((id) => after.get(id))).toEqual(["draft", "draft", "draft"]);
  });
});
