import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeFingerprint } from "./code-fingerprint.mjs";

const folders = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((f) => fs.rm(f, { recursive: true, force: true })));
});

describe("code-fingerprint.mjs", () => {
  it("writes what the model cache module of the build gives into that build", async () => {
    const dist = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-fingerprint-"));
    folders.push(dist);
    await fs.mkdir(path.join(dist, "model"));
    await fs.writeFile(
      path.join(dist, "model", "model-cache.js"),
      'export const FINGERPRINT_FILE = "code-fingerprint.json";\nexport const fingerprintFile = (folder) => JSON.stringify({ folder }) + "\\n";\n',
    );
    const file = await writeFingerprint(dist);
    expect(file).toBe(path.join(dist, "code-fingerprint.json"));
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({ folder: path.resolve(dist) });
  });
});
