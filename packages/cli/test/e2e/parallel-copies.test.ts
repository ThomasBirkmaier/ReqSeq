// End-to-end test of SR-081 AK1 with the built binary: five agents on five clones of one repository on
// one machine, each with its own `logreq serve api` and `logreq mcp` process and one-shot CLI commands,
// all at the same time and all with the same OS user profile (one OS cache folder).
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { LineTransport } from "@logreq/mcp";
import type { FixtureWorkspace } from "@logreq/testkit";
import { cloneFixtureWorkspace, createFixtureWorkspace } from "@logreq/testkit";
import { Client } from "@modelcontextprotocol/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const cliDir = fileURLToPath(new URL("../../", import.meta.url));
const bin = path.join(cliDir, "dist", "bin.js");
// The spawned CLI fails any connection that leaves the machine, like the test process (SR-077).
const blockNetwork = pathToFileURL(
  path.join(cliDir, "..", "..", "scripts", "test-support", "block-network.mjs"),
).href;

const AGENTS = 5;
const PER_ACCESS = 3;

const cleanups: (() => Promise<void>)[] = [];
const children: ChildProcessWithoutNullStreams[] = [];

afterEach(async () => {
  // Wait until each process has ended: Windows cannot remove the folder a running process works in.
  await Promise.all(
    children.splice(0).map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            resolve();
            return;
          }
          child.once("exit", () => {
            resolve();
          });
          child.kill();
        }),
    ),
  );
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

beforeAll(() => {
  if (!existsSync(bin)) {
    throw new Error(`${bin} is missing: run pnpm build before pnpm test:e2e`);
  }
});

/** The profile of the one OS user: every process gets it, so they share one OS cache folder. */
const profile = (home: string): NodeJS.ProcessEnv => ({
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  XDG_CACHE_HOME: home,
  LOCALAPPDATA: home,
});

const spawnLogreq = (root: string, home: string, args: readonly string[]): ChildProcessWithoutNullStreams => {
  const child = spawn(process.execPath, ["--import", blockNetwork, bin, ...args], {
    cwd: root,
    stdio: "pipe",
    env: profile(home),
  });
  // Drain standard error, so that a process writing much there never blocks on a full pipe.
  child.stderr.resume();
  children.push(child);
  return child;
};

/** `logreq <args> --json` as a one-shot process in the copy. */
const oneShot = async (root: string, home: string, args: readonly string[]): Promise<unknown> => {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--import", blockNetwork, bin, ...args, "--json"],
    {
      cwd: root,
      env: profile(home),
    },
  );
  return JSON.parse(stdout);
};

const endpointOf = (child: ChildProcessWithoutNullStreams): Promise<string> =>
  new Promise((resolve, reject) => {
    let text = "";
    child.stdout.on("data", (chunk: Buffer) => {
      text += chunk.toString("utf8");
      const file = /^Port and token: (.+)$/m.exec(text)?.[1];
      if (file !== undefined && text.includes("Stop with Ctrl-C.\n")) {
        resolve(file.trim());
      }
    });
    child.on("exit", () => {
      reject(new Error(`logreq serve api ended early: ${text}`));
    });
  });

const post = (
  url: string,
  token: string,
  name: string,
  input: object,
): Promise<{ status: number | undefined; body: unknown }> =>
  new Promise((resolve, reject) => {
    const req = http.request(
      `${url}/v1/commands/${name}`,
      { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
        });
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify(input));
  });

const titlesIn = async (root: string): Promise<string[]> => {
  const files = await fs.readdir(path.join(root, "needs"));
  const titles = await Promise.all(
    files.map(
      async (file) => /^title: (.+)$/m.exec(await fs.readFile(path.join(root, "needs", file), "utf8"))?.[1],
    ),
  );
  return titles.map(String).sort();
};

const need = (agent: number, access: string, n: number): string =>
  `Need ${String(n)} of agent ${String(agent)} via ${access}`;

describe("separate working copies (SR-081)", () => {
  it("[SR-081/AK1] five agents on five copies run logreq serve api, logreq mcp and CLI commands side by side", async () => {
    const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "logreq-sr-081-home-")));
    cleanups.push(() => fs.rm(home, { recursive: true, force: true, maxRetries: 3 }));
    const origin = await createFixtureWorkspace({ fixture: "SR-004/one-repository", git: true });
    cleanups.push(() => origin.cleanup());
    const copies: FixtureWorkspace[] = [];
    for (let i = 0; i < AGENTS; i++) {
      const copy = await cloneFixtureWorkspace(origin);
      cleanups.push(() => copy.cleanup());
      copies.push(copy);
    }

    // Every agent starts its API and its MCP server at the same time.
    const agents = await Promise.all(
      copies.map(async (copy) => {
        const apiChild = spawnLogreq(copy.root, home, ["serve", "api"]);
        const endpointFile = await endpointOf(apiChild);
        const endpoint = JSON.parse(await fs.readFile(endpointFile, "utf8")) as {
          urls: string[];
          token: string;
        };
        const mcpChild = spawnLogreq(copy.root, home, ["mcp"]);
        const client = new Client({ name: "sr-081", version: "1" });
        await client.connect(
          new LineTransport(mcpChild.stdout, { write: (text) => mcpChild.stdin.write(text) }),
        );
        cleanups.push(() => client.close());
        return { copy, endpointFile, url: endpoint.urls[0] ?? "", token: endpoint.token, client };
      }),
    );

    // Each copy's api.json lies in its own folder of the one OS cache folder (AK2).
    expect(new Set(agents.map((a) => path.dirname(a.endpointFile))).size).toBe(AGENTS);
    for (const { endpointFile } of agents) {
      const relative = path.relative(home, endpointFile);
      expect(relative.startsWith("..") || path.isAbsolute(relative)).toBe(false);
    }

    // All agents create needs at the same time, through the API, MCP and one-shot CLI commands.
    await Promise.all(
      agents.flatMap(({ copy, url, token, client }, agent) =>
        Array.from({ length: PER_ACCESS }, (_, n) => [
          post(url, token, "element.create", {
            type: "need",
            folder: "needs",
            title: need(agent, "API", n),
          }).then((reply) => {
            expect(reply.status).toBe(200);
          }),
          client
            .callTool({
              name: "element_create",
              arguments: { type: "need", folder: "needs", title: need(agent, "MCP", n) },
            })
            .then((result) => {
              expect(result.isError).not.toBe(true);
            }),
          oneShot(copy.root, home, ["element", "create", "need", need(agent, "CLI", n), "--folder", "needs"]),
        ]).flat(),
      ),
    );

    for (const [agent, { copy, url, token }] of agents.entries()) {
      // Each copy holds exactly the needs of its own agent.
      const expected = ["API", "CLI", "MCP"].flatMap((access) =>
        Array.from({ length: PER_ACCESS }, (_, n) => need(agent, access, n)),
      );
      expect(await titlesIn(copy.root)).toEqual(expected.sort());
      // Each API answers only with its own token.
      const foreign = agents[(agent + 1) % AGENTS]?.token ?? "";
      expect((await post(url, foreign, "workspace.status", {})).status).toBe(401);
      expect((await post(url, token, "workspace.status", {})).status).toBe(200);
    }
  }, 120_000);
});
