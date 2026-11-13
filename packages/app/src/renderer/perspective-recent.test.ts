// The perspectives opened last (SR-214 AK1): kept per workspace in the app's storage, never in the
// workspace, and the order of the prompt.
import { describe, expect, it } from "vitest";
import type { PerspectiveStorage } from "./perspective-recent.js";
import {
  PERSPECTIVES_KEPT,
  inOrderOfUse,
  loadPerspectiveUse,
  perspectiveUseKey,
  rememberPerspective,
  savePerspectiveUse,
} from "./perspective-recent.js";

const memory = (
  content: Record<string, string> = {},
): PerspectiveStorage & { content: Record<string, string> } => ({
  content,
  getItem: (key) => content[key] ?? null,
  setItem: (key, value) => {
    content[key] = value;
  },
});

const throwing: PerspectiveStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

const perspective = (name: string) => ({ name, file: `perspectives/${name}.yaml`, where: { all: [] } });

describe("perspectives opened last (SR-214 AK1)", () => {
  it("[SR-214/AK-sd9r] puts the one opened first, once ignoring case and normal form, and keeps a limited number", () => {
    expect(rememberPerspective(["Drafts", "Approved"], "approved")).toEqual(["approved", "Drafts"]);
    expect(rememberPerspective(["Café"], "CAFÉ")).toEqual(["CAFÉ"]);
    const many = Array.from({ length: PERSPECTIVES_KEPT + 5 }, (_, at) => `P${String(at)}`);
    expect(rememberPerspective(many, "New")).toHaveLength(PERSPECTIVES_KEPT);
  });

  it("[SR-214/AK-sd9r] orders the perspectives: opened last first, then by name ignoring case", () => {
    const ordered = inOrderOfUse(["beta", "Alpha", "gamma", "Delta"].map(perspective), [
      "delta",
      "unknown",
      "Gamma",
      "DELTA",
    ]);
    expect(ordered.map((entry) => entry.name)).toEqual(["Delta", "gamma", "Alpha", "beta"]);
  });

  it("[SR-214/AK-sd9r] is stored per workspace in the app's storage; broken content and a failing storage give none", () => {
    const key = perspectiveUseKey({
      ok: true,
      output: { name: "Weather", repositories: [{ name: "spec", path: "." }] },
    });
    expect(key?.split("\n")).toEqual(["reqseq.perspectives.v1", "Weather", "spec=."]);
    expect(
      perspectiveUseKey({ ok: false, error: { code: "workspace.not-found", message: "none" } }),
    ).toBeUndefined();
    const storage = memory();
    savePerspectiveUse(() => storage, "k", ["Drafts"]);
    expect(loadPerspectiveUse(() => storage, "k")).toEqual(["Drafts"]);
    expect(loadPerspectiveUse(() => memory({ k: '["A", 3, null]' }), "k")).toEqual(["A"]);
    expect(loadPerspectiveUse(() => memory({ k: "{}" }), "k")).toEqual([]);
    expect(loadPerspectiveUse(() => memory({ k: "not json" }), "k")).toEqual([]);
    expect(loadPerspectiveUse(() => memory(), "k")).toEqual([]);
    expect(loadPerspectiveUse(() => throwing, "k")).toEqual([]);
    savePerspectiveUse(() => throwing, "k", ["Drafts"]);
  });
});
