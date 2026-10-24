// Separate working copies of one repository on one machine (SR-081): five agents, each on its own clone,
// use the CLI, the MCP server and the local API at the same time. The OS cache folder is one for all of
// them, as for one OS user; each copy gets its own folder in it (ADR-0008) and its own API (ADR-0009).
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import type { ApiServer } from "@logreq/api";
import { startApiServer } from "@logreq/api";
import type { CacheEnvironment, CommandOutput } from "@logreq/core";
import { Workspace, cacheFolder, createCommandRuntime, watchWorkspace } from "@logreq/core";
import { LineTransport, serveMcp } from "@logreq/mcp";
import type { FixtureWorkspace } from "@logreq/testkit";
import { cloneFixtureWorkspace, createFixtureWorkspace } from "@logreq/testkit";
import { Client } from "@modelcontextprotocol/client";
import { describe, expect, it, onTestFinished } from "vitest";
import { EXIT, runCli } from "../src/index.js";

const runtime = createCommandRuntime();

/** Agents, one per copy (SR-081 AK1). */
const AGENTS = 5;

/** Needs each agent creates through each access. */
const PER_ACCESS = 4;

type Created = CommandOutput<"element.create">;

/** A file written by another process shows in a running workspace within 2 s (SR-007 AK1); slack for CI. */
const SEEN_LIMIT_MS = 10_000;

/** One OS cache folder for every copy, as one OS user has: `base` stands for the profile. */
const sharedCache = async (): Promise<{ readonly base: string; readonly env: CacheEnvironment }> => {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "logreq-sr-081-cache-")));
  onTestFinished(() => fs.rm(base, { recursive: true, force: true, maxRetries: 3 }));
  return {
    base,
    env: { platform: process.platform, env: { XDG_CACHE_HOME: base, LOCALAPPDATA: base }, home: base },
  };
};

/** The fixture as a Git repository, cloned `count` times; everything is removed after the test. */
const clones = async (
  count: number,
): Promise<{ readonly origin: FixtureWorkspace; readonly copies: readonly FixtureWorkspace[] }> => {
  const origin = await createFixtureWorkspace({ fixture: "SR-004/one-repository", git: true });
  onTestFinished(() => origin.cleanup());
  const copies = await Promise.all(
    Array.from({ length: count }, async () => {
      const copy = await cloneFixtureWorkspace(origin);
      onTestFinished(() => copy.cleanup());
      return copy;
    }),
  );
  return { origin, copies };
};

/** A workspace that stays open with its watcher, as in `logreq serve api` and `logreq mcp`. */
const serving = (root: string): Workspace => {
  const workspace = new Workspace(root);
  watchWorkspace(workspace);
  // Registered after the copy's cleanup, so it runs first: Windows cannot remove a watched folder.
  onTestFinished(() => workspace.close());
  return workspace;
};

const api = async (root: string, folder: string): Promise<{ server: ApiServer; token: string }> => {
  const server = await startApiServer({ workspace: serving(root), runtime, cacheFolder: folder });
  onTestFinished(() => server.close());
  const { token } = JSON.parse(await fs.readFile(server.endpointFile, "utf8")) as { token: string };
  return { server, token };
};

const post = (
  server: ApiServer,
  token: string,
  name: string,
  input: object,
): Promise<{ readonly status: number | undefined; readonly body: unknown }> =>
  new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: server.port,
        method: "POST",
        path: `/v1/commands/${name}`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      },
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

/** An MCP session on its own workspace of the copy, as `logreq mcp` has. */
const mcp = async (root: string): Promise<Client> => {
  const toServer = new PassThrough();
  const toClient = new PassThrough();
  const served = serveMcp({
    runtime,
    workspace: serving(root),
    input: toServer,
    output: { write: (t) => toClient.write(t) },
  });
  const client = new Client({ name: "sr-081", version: "1" });
  await client.connect(new LineTransport(toClient, { write: (t) => toServer.write(t) }));
  onTestFinished(async () => {
    toServer.end();
    await served;
    await client.close();
  });
  return client;
};

class Sink {
  text = "";
  write(text: string): boolean {
    this.text += text;
    return true;
  }
}

/** `logreq <argv> --json` in the copy, a one-shot command with its own workspace. */
const cli = async (root: string, argv: readonly string[]): Promise<unknown> => {
  const stdout = new Sink();
  const stderr = new Sink();
  const code = await runCli({
    argv: [...argv, "--json"],
    cwd: root,
    stdin: Readable.from([]),
    stdout,
    stderr,
    runtime,
  });
  expect([code, stderr.text]).toEqual([EXIT.ok, ""]);
  return JSON.parse(stdout.text);
};

const titlesIn = async (root: string): Promise<string[]> => {
  const files = await fs.readdir(path.join(root, "needs"));
  const titles = await Promise.all(
    files.map(async (file) => {
      const text = await fs.readFile(path.join(root, "needs", file), "utf8");
      return /^title: (.+)$/m.exec(text)?.[1] ?? file;
    }),
  );
  return titles.sort();
};

/** The entry at `index` of a list, counted round (the one after the last is the first). */
const nth = <T>(list: readonly T[], index: number): T => {
  const entry = list[index % list.length];
  if (entry === undefined) {
    throw new Error(`no entry ${String(index)}`);
  }
  return entry;
};

const need = (agent: number, access: string, n: number): string =>
  `Need ${String(n)} of agent ${String(agent)} via ${access}`;

describe("separate working copies used at the same time (SR-081)", { timeout: 120_000 }, () => {
  it("[SR-081/AK1] five copies of one repository, used at the same time through CLI, MCP and API, do not disturb each other", async () => {
    const { base, env } = await sharedCache();
    const { copies } = await clones(AGENTS);
    // Each agent starts its API and its MCP server; all ten run side by side.
    const servers = await Promise.all(
      copies.map(async (copy) => ({
        copy,
        api: await api(copy.root, cacheFolder(copy.root, env)),
        mcp: await mcp(copy.root),
      })),
    );

    // All agents create needs at the same time, each through the CLI, MCP and the API at once.
    const work = servers.flatMap(({ copy, api: { server, token }, mcp: client }, agent) =>
      Array.from({ length: PER_ACCESS }, (_, n) => [
        cli(copy.root, ["element", "create", "need", need(agent, "CLI", n), "--folder", "needs"]),
        client
          .callTool({
            name: "element_create",
            arguments: { type: "need", folder: "needs", title: need(agent, "MCP", n) },
          })
          .then((result) => {
            expect(result.isError).not.toBe(true);
            return result.structuredContent;
          }),
        post(server, token, "element.create", {
          type: "need",
          folder: "needs",
          title: need(agent, "API", n),
        }).then((reply) => {
          expect(reply.status).toBe(200);
          return reply.body;
        }),
      ]).flat(),
    );
    const outputs = (await Promise.all(work)) as Created[];
    expect(new Set(outputs.map((o) => o.element.id)).size).toBe(AGENTS * 3 * PER_ACCESS);

    for (const [agent, { copy, api: own }] of servers.entries()) {
      // Each copy holds exactly its own agent's needs, whichever access wrote them.
      const expected = ["API", "CLI", "MCP"].flatMap((access) =>
        Array.from({ length: PER_ACCESS }, (_, n) => need(agent, access, n)),
      );
      expect(await titlesIn(copy.root)).toEqual(expected.sort());
      // Each running API sees its own copy only: it finds the needs of its agent, also those that the
      // CLI and MCP wrote (its watcher shows them within the bound of SR-007), and not those of the next
      // agent. element.get is not implemented yet (stage 1 has no read command with a reference), so the
      // lookup is an element.update of the text; switch to element.get once it exists.
      const mine = outputs.slice(agent * 3 * PER_ACCESS, (agent + 1) * 3 * PER_ACCESS);
      const next = nth(outputs, (agent + 1) * 3 * PER_ACCESS);
      for (const { element } of mine) {
        const deadline = performance.now() + SEEN_LIMIT_MS;
        let reply = await post(own.server, own.token, "element.update", {
          ref: element.shortId,
          text: "Seen.\n",
        });
        while (reply.status === 404 && performance.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          reply = await post(own.server, own.token, "element.update", {
            ref: element.shortId,
            text: "Seen.\n",
          });
        }
        expect(reply.status).toBe(200);
      }
      const other = await post(own.server, own.token, "element.update", {
        ref: next.element.shortId,
        text: "x\n",
      });
      expect(other.body).toMatchObject({ code: "ref.unknown" });
      const status = (await post(own.server, own.token, "workspace.status", {})).body as {
        problems: unknown[];
      };
      expect(status.problems).toEqual([]);
      // Nothing of LogReq lies in the working tree: only the new element files are untracked.
      const changes = (await copy.git(["status", "--porcelain", "--untracked-files=all"])).trim().split("\n");
      expect(changes).toHaveLength(3 * PER_ACCESS);
      for (const line of changes) {
        expect(line).toMatch(/^\?\? needs\/N-[0-9a-f]{12}\.md$/);
      }
    }

    // AK2: one cache folder per copy in the shared OS cache folder, each with its own api.json.
    const endpointFiles = servers.map(({ api: { server } }) => server.endpointFile);
    expect(new Set(endpointFiles.map((file) => path.dirname(file))).size).toBe(AGENTS);
    for (const [agent, { copy, api: own }] of servers.entries()) {
      expect(path.dirname(own.server.endpointFile)).toBe(cacheFolder(copy.root, env));
      const relative = path.relative(base, own.server.endpointFile);
      expect(relative.startsWith("..") || path.isAbsolute(relative)).toBe(false);
      // An API answers only with the token of its own copy.
      const foreign = nth(servers, agent + 1).api.token;
      expect((await post(own.server, foreign, "workspace.status", {})).status).toBe(401);
    }
  });

  it("[SR-081/AK2] after a copy was moved, a new clone at its old path and the moved copy each run their own API", async () => {
    const { env } = await sharedCache();
    const { origin, copies } = await clones(1);
    const copy = nth(copies, 0);
    const old = copy.root;
    const oldFolder = cacheFolder(old, env);
    // The API of the copy crashed: its api.json stays behind with a process ID that does not run.
    const before = new Workspace(old);
    const crashed = await startApiServer({ workspace: before, runtime, cacheFolder: oldFolder });
    await crashed.close();
    await before.close();
    await fs.writeFile(
      crashed.endpointFile,
      JSON.stringify({ "logreq-api": 1, port: 1, token: "t", urls: ["http://127.0.0.1:1"], pid: 2147483646 }),
    );

    // Someone moves the copy away (inside the fixture's temporary folder, so cleanup removes it) and
    // clones the repository again at the old path.
    const moved = `${old}-moved`;
    await fs.rename(old, moved);
    await fs.mkdir(old);
    await copy.git(["clone", "--quiet", origin.root, "."]);

    // The new clone takes over the cache folder of the path and replaces the stale api.json; the moved
    // copy gets a new cache folder. Both APIs run at once, each on its own copy.
    const [atOld, atMoved] = await Promise.all([
      api(old, cacheFolder(old, env)),
      api(moved, cacheFolder(moved, env)),
    ]);
    expect(atOld.server.endpointFile).toBe(crashed.endpointFile);
    expect(atOld.token).not.toBe("t");
    expect(path.dirname(atMoved.server.endpointFile)).not.toBe(oldFolder);
    const [inOld, inMoved] = (await Promise.all([
      post(atOld.server, atOld.token, "element.create", {
        type: "need",
        folder: "needs",
        title: "New clone",
      }),
      post(atMoved.server, atMoved.token, "element.create", {
        type: "need",
        folder: "needs",
        title: "Moved copy",
      }),
    ])) as [{ body: Created }, { body: Created }];
    expect(await titlesIn(old)).toEqual(["New clone"]);
    expect(await titlesIn(moved)).toEqual(["Moved copy"]);
    expect(inOld.body.element.id).not.toBe(inMoved.body.element.id);
  });
});
