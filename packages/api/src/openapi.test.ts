// schemas/generated/openapi.json describes what the API does (ADR-0003): one path per catalog command
// and every status the server answers with.
import fs from "node:fs/promises";
import path from "node:path";
import { loadContracts } from "@logreq/core";
import { describe, expect, it } from "vitest";
import { COMMANDS_PATH, HTTP_STATUS_BY_CLASS } from "./handler.js";

interface Operation {
  readonly responses: Readonly<Record<string, unknown>>;
}

const file = path.join(import.meta.dirname, "..", "..", "..", "schemas", "generated", "openapi.json");

describe("openapi.json", () => {
  it("has the catalog endpoint and one POST endpoint per catalog command, with every status", async () => {
    const openapi = JSON.parse(await fs.readFile(file, "utf8")) as {
      paths: Record<string, { get?: Operation; post?: Operation }>;
    };
    const names = loadContracts().commands.map((e) => e.name);
    expect(Object.keys(openapi.paths)).toEqual([COMMANDS_PATH, ...names.map((n) => `${COMMANDS_PATH}/${n}`)]);
    expect(Object.keys(openapi.paths[COMMANDS_PATH]?.get?.responses ?? {})).toEqual(["200", "401", "403"]);
    const statuses = [200, 401, 403, 413, ...Object.values(HTTP_STATUS_BY_CLASS)].map(String).sort();
    for (const name of names) {
      const responses = openapi.paths[`${COMMANDS_PATH}/${name}`]?.post?.responses ?? {};
      expect(Object.keys(responses).sort()).toEqual([...new Set(statuses)]);
    }
  });
});
