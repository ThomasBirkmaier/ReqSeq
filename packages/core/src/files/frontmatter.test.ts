import { describe, expect, it } from "vitest";
import { findConflictMarker, splitFrontmatter } from "./index.js";

describe("splitFrontmatter", () => {
  it("splits YAML and body with LF", () => {
    expect(splitFrontmatter("---\nid: a\n---\n# Text\n")).toEqual({
      kind: "frontmatter",
      yaml: "id: a\n",
      body: "# Text\n",
      eol: "\n",
      closingEol: "\n",
    });
  });

  it("splits YAML and body with CRLF", () => {
    expect(splitFrontmatter("---\r\nid: a\r\n---\r\nText\r\n")).toEqual({
      kind: "frontmatter",
      yaml: "id: a\r\n",
      body: "Text\r\n",
      eol: "\r\n",
      closingEol: "\r\n",
    });
  });

  it("accepts a closing line at the end of the file without newline", () => {
    expect(splitFrontmatter("---\nid: a\n---")).toEqual({
      kind: "frontmatter",
      yaml: "id: a\n",
      body: "",
      eol: "\n",
      closingEol: "",
    });
  });

  it("accepts empty frontmatter", () => {
    expect(splitFrontmatter("---\n---\nbody")).toEqual({
      kind: "frontmatter",
      yaml: "",
      body: "body",
      eol: "\n",
      closingEol: "\n",
    });
  });

  it("keeps the line ending of the closing line apart from the opening one", () => {
    expect(splitFrontmatter("---\nid: a\r\n---\r\nText\n")).toMatchObject({
      eol: "\n",
      closingEol: "\r\n",
      yaml: "id: a\r\n",
    });
    expect(splitFrontmatter("---\r\nid: a\n---\nText")).toMatchObject({ eol: "\r\n", closingEol: "\n" });
  });

  it("reports no frontmatter when the first line is not ---", () => {
    expect(splitFrontmatter("# Title\n---\n")).toEqual({ kind: "none" });
    expect(splitFrontmatter("")).toEqual({ kind: "none" });
    expect(splitFrontmatter("----\na: 1\n---\n")).toEqual({ kind: "none" });
    expect(splitFrontmatter(" ---\na: 1\n---\n")).toEqual({ kind: "none" });
  });

  it("reports an unclosed frontmatter", () => {
    expect(splitFrontmatter("---\nid: a\n")).toEqual({ kind: "unclosed" });
    expect(splitFrontmatter("---")).toEqual({ kind: "unclosed" });
    expect(splitFrontmatter("---\nid: a\n----\n")).toEqual({ kind: "unclosed" });
  });

  it("does not split at a later --- inside the body", () => {
    const r = splitFrontmatter("---\na: 1\n---\ntext\n---\nmore\n");
    expect(r).toMatchObject({ kind: "frontmatter", yaml: "a: 1\n", body: "text\n---\nmore\n" });
  });
});

describe("findConflictMarker", () => {
  it("finds an ordered start, separator and end marker and returns the start line", () => {
    expect(findConflictMarker("a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> other\n")).toBe(2);
    expect(findConflictMarker("<<<<<<<\n=======\n>>>>>>>")).toBe(1);
    expect(findConflictMarker("a\r\n<<<<<<< HEAD\r\nb\r\n=======\r\nc\r\n>>>>>>> x\r\n")).toBe(2);
    expect(findConflictMarker("<<<<<<< A\n<<<<<<< B\n||||||| base\n=======\n>>>>>>> C\n")).toBe(2);
    expect(findConflictMarker("<<<<<<< A\n=======\n<<<<<<< B\n>>>>>>> C\n")).toBe(1);
  });

  it("counts lines only at \\n", () => {
    expect(findConflictMarker("a\rb\n<<<<<<< HEAD\n=======\n>>>>>>> x\n")).toBe(2);
  });

  it("ignores single marker-like lines and wrong order", () => {
    expect(findConflictMarker("Title\n=======\n")).toBeUndefined();
    expect(findConflictMarker("> quote\n>>>>>>> deep quote\n")).toBeUndefined();
    expect(findConflictMarker("<<<<<<< HEAD\nonly start\n")).toBeUndefined();
    expect(findConflictMarker("<<<<<<< HEAD\n>>>>>>> x\n=======\n")).toBeUndefined();
    expect(findConflictMarker("=======\n<<<<<<< HEAD\n>>>>>>> x\n")).toBeUndefined();
    expect(findConflictMarker(">>>>>>> x\n<<<<<<< HEAD\n=======\n")).toBeUndefined();
    expect(findConflictMarker("<<<<<<<<\n=======\n>>>>>>>\n")).toBeUndefined();
    expect(findConflictMarker("<<<<<<<HEAD\n=======\n>>>>>>>\n")).toBeUndefined();
    expect(findConflictMarker("<<<<<<< a\n======= \n>>>>>>> b\n")).toBeUndefined();
    expect(findConflictMarker("")).toBeUndefined();
  });
});
