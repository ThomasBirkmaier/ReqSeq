import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { check, protectedReason } from "./protect-files.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("protect-files hook", () => {
  it("blocks generated files and spec elements", () => {
    expect(protectedReason("schemas/generated/openapi.json")).toMatch(/contracts:generate/);
    expect(protectedReason("packages/core/src/generated/types.ts")).toMatch(/contracts:generate/);
    expect(protectedReason("spec/system-requirement/SR-036.md")).toMatch(/ReqSeq CLI/);
  });

  it("allows the hand-edited spec files and everything else", () => {
    expect(protectedReason("spec/metamodel/standard-model.yaml")).toBeUndefined();
    expect(protectedReason("spec/reqseq-workspace.yaml")).toBeUndefined();
    expect(protectedReason("spec/README.md")).toBeUndefined();
    expect(protectedReason("fixtures/SR-062/subfolder/spec/requirements/SR-0000000000b1.md")).toBeUndefined();
    expect(protectedReason("packages/core/src/commands/x.ts")).toBeUndefined();
  });

  it("resolves the path against the checkout and returns exit code 2 only when protected", () => {
    const edit = (file) => check({ cwd: root, tool_input: { file_path: file } });
    expect(edit("schemas/generated/new-file.json").code).toBe(2);
    expect(edit(path.join(root, "spec/need/new/N-999.md")).code).toBe(2);
    expect(edit("CLAUDE.md")).toEqual({ code: 0 });
    expect(check({ tool_input: {} })).toEqual({ code: 0 });
    expect(check({ cwd: "/", tool_input: { file_path: "/nonexistent-dir/x" } })).toEqual({ code: 0 });
  });

  it("sees through a symlinked checkout", () => {
    const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "protect-")), "repo");
    fs.symlinkSync(root, link, "junction");
    try {
      expect(check({ cwd: link, tool_input: { file_path: "spec/need/x.md" } }).code).toBe(2);
    } finally {
      fs.rmSync(path.dirname(link), { recursive: true, force: true });
    }
  });
});
