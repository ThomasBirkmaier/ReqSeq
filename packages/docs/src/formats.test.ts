import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkFormats,
  commonTypesPage,
  formatPage,
  formatsIndex,
  readExamples,
  schemaLink,
} from "./formats.js";

const schema = (name: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  $id: `https://reqseq.dev/schemas/${name}.schema.json`,
  ...extra,
});

describe("formats", () => {
  it("fails on a schema that is neither documented nor internal", () => {
    expect(() => {
      checkFormats([schema("workspace"), schema("activity"), schema("common")]);
    }).not.toThrow();
    expect(() => {
      checkFormats([schema("new-format")]);
    }).toThrow("Schemas neither documented nor internal (packages/docs/src/formats.ts): new-format");
  });

  it("links a type to its format page or the common types, never to an internal format", () => {
    const link = schemaLink("/ReqSeq/");
    const at = (ref: string): string | undefined =>
      link(new URL(ref, "https://reqseq.dev/schemas/x.schema.json"));
    expect(at("common.schema.json#/$defs/uuid")).toBe("/ReqSeq/reference/common-types/#uuid");
    expect(at("filter.schema.json#/$defs/sortKey")).toBe("/ReqSeq/reference/formats/filter/#sortKey");
    expect(at("data-export.schema.json")).toBe("/ReqSeq/reference/formats/data-export/");
    expect(at("activity.schema.json#/$defs/access")).toBeUndefined();
  });

  it("reads no examples where a format has none", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reqseq-docs-"));
    expect((await readExamples(dir))["workspace"]).toEqual([]);
    await rm(dir, { recursive: true, force: true });
  });

  it("keeps an error of reading an example folder other than a missing one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reqseq-docs-"));
    await mkdir(join(dir, "schemas", "examples"), { recursive: true });
    await writeFile(join(dir, "schemas", "examples", "workspace"), "a file, no folder");
    await expect(readExamples(dir)).rejects.toMatchObject({ code: "ENOTDIR" });
    await rm(dir, { recursive: true, force: true });
  });

  it("renders a format without title, fields, definitions or examples, and examples by their language", () => {
    const bare = formatPage(schema("baseline", { type: "string" }), [], { schemas: [] }, 1);
    expect(bare).toContain('title: "baseline"');
    expect(bare).toContain("## Fields\n\nType: `string`.\n");
    expect(bare).not.toContain("## Definitions");
    expect(bare).not.toContain("## Examples");
    const files = ["a.md", "b.json", "c.yaml"].map((file) => ({ file, text: "x\n" }));
    const page = formatPage(schema("baseline", { title: "Baseline" }), files, { schemas: [] }, 1);
    expect(page).toContain("```markdown\nx\n```");
    expect(page).toContain("```json\nx\n```");
    expect(page).toContain("```yaml\nx\n```");
  });

  it("gives every common definition an anchor and lists internal formats by name", () => {
    const common = schema("common", {
      $defs: { uuid: { type: "string", description: "An ID." }, isFlag: {} },
    });
    const page = commonTypesPage(common, { schemas: [common] });
    expect(page).toContain("\n### `uuid`\n\nAn ID.\n\nType: `string`.");
    expect(page).not.toContain('<a id="uuid">');
    expect(page).toContain('<a id="isFlag"></a>\n\n### `isFlag`\n\nType: `any`.');
    const index = formatsIndex([schema("workspace", { title: "Workspace file" })], "/");
    expect(index).toContain("- [Workspace file](/reference/formats/workspace/)");
    expect(index).toContain("- [baseline](/reference/formats/baseline/)");
    expect(index).toContain("activity (`activity`)");
  });
});
