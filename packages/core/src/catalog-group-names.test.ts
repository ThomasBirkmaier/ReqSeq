import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOG_GROUP_NAMES, catalogGroupName } from "./catalog.js";

const commands = path.resolve(import.meta.dirname, "../../../schemas/commands");

describe("catalogGroupName", () => {
  it("names every group of the catalog, and only those", () => {
    const groups = new Set(
      readdirSync(commands)
        .filter((file) => /^[a-z]+\.[a-zA-Z]+\.json$/.test(file) && !file.startsWith("catalog."))
        .map((file) => file.slice(0, file.indexOf("."))),
    );
    expect(Object.keys(CATALOG_GROUP_NAMES).sort()).toEqual([...groups].sort());
  });

  it("gives the name for people, or the key of a group without one", () => {
    expect(catalogGroupName("reqif")).toBe("ReqIF");
    expect(catalogGroupName("tool")).toBe("ReqSeq");
    expect(catalogGroupName("test")).toBe("test");
    expect(catalogGroupName("toString")).toBe("toString");
  });
});
