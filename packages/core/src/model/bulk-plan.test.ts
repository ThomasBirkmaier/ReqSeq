import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PlanEntry } from "./bulk-plan.js";
import { planFingerprint } from "./bulk-plan.js";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

const A: PlanEntry = { repository: "b", file: "a.md", id: "id-1", sha256: "11", bytes: bytes("a") };
const B: PlanEntry = { repository: "a", file: "x/b.md", id: "id-2", sha256: "22", bytes: bytes("bb") };

describe("planFingerprint (#158)", () => {
  it("hashes each entry's header and bytes in path order (golden vector)", () => {
    // SHA-256 of `["a","x/b.md","id-2","22",2]\nbb["b","a.md","id-1","11",1]\na`.
    const golden = "p1:bee6a2ad4663c6fb6b4f8421e721d02c74a492a82d8ee40978d6bb30056caa9c";
    expect(planFingerprint([A, B])).toBe(golden);
    expect(planFingerprint([B, A])).toBe(golden);
    // No entry: the SHA-256 of nothing.
    expect(planFingerprint([])).toBe("p1:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("sorts by code units within a repository, not by locale", () => {
    const upper: PlanEntry = { ...A, file: "Z.md" };
    const lower: PlanEntry = { ...A, file: "a.md" };
    const header = (e: PlanEntry): string =>
      `${JSON.stringify([e.repository, e.file, e.id, e.sha256, e.bytes.length])}\n`;
    // "Z" (U+005A) comes before "a" (U+0061); `localeCompare` would put "a.md" first.
    const hash = createHash("sha256");
    for (const part of [header(upper), "a", header(lower), "a"]) {
      hash.update(part);
    }
    expect(planFingerprint([lower, upper])).toBe(`p1:${hash.digest("hex")}`);
  });

  it("changes with every part of an entry", () => {
    const base = planFingerprint([A]);
    for (const changed of [
      { ...A, repository: "c" },
      { ...A, file: "other.md" },
      { ...A, id: "id-9" },
      { ...A, sha256: "12" },
      { ...A, bytes: bytes("b") },
    ]) {
      expect(planFingerprint([changed])).not.toBe(base);
    }
    // The length in the header frames the bytes: two entries cannot run into one.
    expect(planFingerprint([{ ...A, bytes: bytes("ab") }])).not.toBe(
      planFingerprint([A, { ...A, file: "b.md", bytes: bytes("b") }]),
    );
  });
});
