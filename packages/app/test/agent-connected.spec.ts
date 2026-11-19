// The connected agent in the modeline (SR-228 AK1–AK3) on the built app: real `reqseq mcp` processes on the same
// copy and with the same cache folder are the agents (`running.mcpRaw()` of `support/app.ts`); the test writes
// their messages as a client of either protocol revision does, ends them cleanly or kills them as a crash does.
// Who is connected, since when, and the cut of a name come from core (`workspace.agents`); the expected hover
// takes its times from the command line on the same copy. Times are measured on this machine's clock: in the
// window, the frame after the modeline changed, against the test's clock at the answer, arrival or end.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { localTime } from "../src/renderer/agent-status.js";
import type { RawMcp, RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

const OUT =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

const FIXTURE = { fixture: "SR-069/filter" };

/** AK1: „höchstens 1 s nach dieser Antwort oder diesem Eingang“. */
const CONNECTED_MS = 1000;
/** AK2: „höchstens 5 s danach“. */
const ENDED_MS = 5000;

/** The revision without `initialize` and the `_meta` keys of its requests. */
const REVISION = "2026-07-28";
const PROTOCOL_VERSION_KEY = "io.modelcontextprotocol/protocolVersion";

const agent = (window: Page) => window.locator(".modeline .agent");

const ready = async (window: Page): Promise<void> => {
  await window.locator('[aria-label="Sheet"] > *').first().waitFor();
};

/** Starts a server and connects it with `initialize`; resolves to the test's clock at the answer. */
const initialized = async (raw: RawMcp, clientInfo?: Record<string, unknown>): Promise<number> => {
  const answer = await raw.request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    ...(clientInfo === undefined ? {} : { clientInfo }),
  });
  const at = Date.now();
  expect(answer["result"]).toBeDefined();
  raw.write({ method: "notifications/initialized" });
  return at;
};

/**
 * Notes in the window the epoch time of the frame after the modeline's agent part shows `state` (`data-agent`);
 * `shownAt` reads it.
 */
const arm = (window: Page, state: "connected" | "ended"): Promise<void> =>
  window.evaluate((state) => {
    const page = window as unknown as { agentShown?: number };
    delete page.agentShown;
    const seen = (): boolean => document.querySelector(`.modeline .agent[data-agent="${state}"]`) !== null;
    const note = (): void => {
      requestAnimationFrame(() => {
        page.agentShown = performance.timeOrigin + performance.now();
      });
    };
    if (seen()) {
      note();
      return;
    }
    const observer = new MutationObserver(() => {
      if (seen()) {
        observer.disconnect();
        note();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  }, state);

/** The time `arm` noted, once the window shows the state (at most 10 s). */
const shownAt = async (window: Page): Promise<number> => {
  const read = (): Promise<number | undefined> =>
    window.evaluate(() => (window as unknown as { agentShown?: number }).agentShown);
  await expect.poll(read, { timeout: 10_000 }).toBeDefined();
  return (await read()) ?? 0;
};

interface Agents {
  readonly recorded: boolean;
  readonly connected: readonly { readonly client: string | null; readonly since: string }[];
  readonly last: { readonly client: string | null; readonly at: string } | null;
}

/** `reqseq workspace agents --json` on the app's copy. */
const agentsOf = async (running: RunningApp): Promise<Agents> => {
  const cli = await running.cli(["workspace", "agents"]);
  expect(cli.code).toBe(0);
  return JSON.parse(cli.stdout) as Agents;
};

/** The hover of the connected state for these connections, the client as core gives it. */
const connectedHover = (agents: Agents): string =>
  agents.connected
    .map((c) => `${c.client ?? "unknown client"} · connected since ${localTime(c.since)}`)
    .join("\n");

/** The modeline's colour of the secondary texts (`--muted`), as the browser resolves it. */
const mutedColour = (window: Page): Promise<string> =>
  window.locator(".modeline").evaluate((modeline) => getComputedStyle(modeline).color);

const graphemes = (text: string): string[] =>
  [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text)].map((s) => s.segment);

let running: RunningApp | undefined;
test.afterEach(async () => {
  await running?.close();
  running = undefined;
});

test("[SR-228/AK-d19d] never connected: a quiet Connect AI agent in the secondary-text colour, whose click starts Connect AI agent", async () => {
  running = await launchApp(FIXTURE);
  const { window } = running;
  await ready(window);
  await expect(agent(window)).toHaveText("Connect AI agent");
  await expect(agent(window)).toHaveAttribute("data-agent", "never");
  await expect(agent(window).locator(".agent-dot")).toHaveCount(0);
  expect(await agent(window).evaluate((part) => getComputedStyle(part).color)).toBe(
    await mutedColour(window),
  );
  expect((await agentsOf(running)).last).toBeNull();
  await window.screenshot({ path: path.join(OUT, "sr-228-connect-ai-agent-light.png") });
  await agent(window).click();
  await expect(window.locator("label.prompt-label")).toHaveText("Connect AI agent · client:");
});

test("[SR-228/AK-zn8v] an initialize client: a green dot and Agent connected at most 1 s after the answer, the hover names it and since when", async () => {
  running = await launchApp(FIXTURE);
  const { window } = running;
  await ready(window);
  await expect(agent(window)).toHaveText("Connect AI agent");
  const server = running.mcpRaw();
  await arm(window, "connected");
  const answered = await initialized(server, { name: "Claude Code", version: "1" });
  const shown = await shownAt(window);
  expect(shown - answered).toBeLessThanOrEqual(CONNECTED_MS);
  await expect(agent(window)).toHaveText("Agent connected");
  // Green, the token of a connected agent in light: #1a7f37.
  expect(
    await agent(window)
      .locator(".agent-dot")
      .evaluate((dot) => getComputedStyle(dot).backgroundColor),
  ).toBe("rgb(26, 127, 55)");
  const agents = await agentsOf(running);
  expect(agents.connected.map((c) => c.client)).toEqual(["Claude Code"]);
  await expect(agent(window)).toHaveAttribute("title", connectedHover(agents));
  await expect(agent(window)).toHaveAttribute(
    "title",
    /^Claude Code · connected since \d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/,
  );
  await window.screenshot({ path: path.join(OUT, "sr-228-agent-connected-light.png") });
  // A clean end turns it grey as well (AK2).
  await arm(window, "ended");
  await server.close();
  const ended = Date.now();
  expect((await shownAt(window)) - ended).toBeLessThanOrEqual(ENDED_MS);
});

test("[SR-228/AK-zn8v] a client of a revision without initialize: green at most 1 s after its first request arrives, without an answer, since that arrival, unknown client without a name", async () => {
  running = await launchApp(FIXTURE);
  const { window } = running;
  await ready(window);
  await expect(agent(window)).toHaveText("Connect AI agent");
  const server = running.mcpRaw();
  // A ping first, which names no revision and connects nothing: the server reads its input, so the arrival is
  // the write.
  expect((await server.request("ping", {}))["result"]).toBeDefined();
  await expect(agent(window)).toHaveText("Connect AI agent");
  await arm(window, "connected");
  const sent = Date.now();
  // `subscriptions/listen` waits for no answer: the arrival connects (no clientInfo: no name).
  server.write({
    id: 1,
    method: "subscriptions/listen",
    params: { _meta: { [PROTOCOL_VERSION_KEY]: REVISION } },
  });
  const shown = await shownAt(window);
  expect(shown - sent).toBeLessThanOrEqual(CONNECTED_MS);
  const agents = await agentsOf(running);
  expect(agents.connected).toHaveLength(1);
  const since = Date.parse(agents.connected[0]?.since ?? "");
  // The arrival: after the write, before the window showed it, and green at most 1 s after it.
  expect(since).toBeGreaterThanOrEqual(sent - 5);
  expect(since).toBeLessThanOrEqual(shown);
  expect(shown - since).toBeLessThanOrEqual(CONNECTED_MS);
  await expect(agent(window)).toHaveText("Agent connected");
  await expect(agent(window)).toHaveAttribute("title", connectedHover(agents));
  await expect(agent(window)).toHaveAttribute("title", /^unknown client · connected since /);
});

test("[SR-228/AK-zn8v] names over 40 characters are cut at the 40th grapheme cluster, whole, and a name of only control or format characters is unknown client", async () => {
  running = await launchApp(FIXTURE);
  const { window } = running;
  await ready(window);
  // The 40th character a decomposed accented letter (e + U+0301), and a ZWJ emoji (woman technologist).
  const accented = `${"a".repeat(39)}e\u0301${"tail".repeat(5)}`;
  const emoji = `${"b".repeat(39)}\u{1f469}\u200d\u{1f4bb}${"tail".repeat(5)}`;
  await initialized(running.mcpRaw(), { name: accented, version: "1" });
  await initialized(running.mcpRaw(), { name: emoji, version: "1" });
  // Control and format characters only (a bell, a zero width space, a right-to-left override).
  await initialized(running.mcpRaw(), { name: "\u0007\u200b\u202e", version: "1" });
  await expect(agent(window)).toHaveText("Agent connected");
  const app = running;
  await expect.poll(async () => (await agentsOf(app)).connected.length).toBe(3);
  const agents = await agentsOf(app);
  await expect(agent(window)).toHaveAttribute("title", connectedHover(agents));
  const lines = ((await agent(window).getAttribute("title")) ?? "").split("\n");
  const names = lines.map((line) => line.slice(0, line.indexOf(" · connected since ")));
  expect(names).toHaveLength(3);
  // Connected one after the other, so the first connected first.
  const [first, second, third] = names;
  expect(graphemes(first ?? "")).toHaveLength(40);
  expect(graphemes(first ?? "").at(-1)).toBe("e\u0301");
  expect(first).toBe(`${"a".repeat(39)}e\u0301`);
  expect(graphemes(second ?? "")).toHaveLength(40);
  expect(graphemes(second ?? "").at(-1)).toBe("\u{1f469}\u200d\u{1f4bb}");
  expect(second).toBe(`${"b".repeat(39)}\u{1f469}\u200d\u{1f4bb}`);
  expect(third).toBe("unknown client");
});

test("[SR-228/AK-v1gc] after a crash of the last server: a grey dot and No agent connected at most 5 s later, the hover names the client and when; a click starts Connect AI agent", async () => {
  running = await launchApp(FIXTURE);
  const { window } = running;
  await ready(window);
  const server = running.mcpRaw();
  await initialized(server, { name: "Claude Code", version: "1" });
  await expect(agent(window)).toHaveText("Agent connected");
  await arm(window, "ended");
  await server.kill();
  const crashed = Date.now();
  const shown = await shownAt(window);
  expect(shown - crashed).toBeLessThanOrEqual(ENDED_MS);
  await expect(agent(window)).toHaveText("No agent connected");
  await expect(agent(window).locator(".agent-dot")).toHaveCount(1);
  // Grey: the colour of the secondary texts, not the green of AK1.
  expect(
    await agent(window)
      .locator(".agent-dot")
      .evaluate((dot) => getComputedStyle(dot).backgroundColor),
  ).toBe(await mutedColour(window));
  const { connected, last } = await agentsOf(running);
  expect(connected).toEqual([]);
  expect(last?.client).toBe("Claude Code");
  await expect(agent(window)).toHaveAttribute(
    "title",
    `Claude Code · last connected ${localTime(last?.at ?? "")}`,
  );
  await window.screenshot({ path: path.join(OUT, "sr-228-no-agent-light.png") });
  await agent(window).click();
  await expect(window.locator("label.prompt-label")).toHaveText("Connect AI agent · client:");
});

test("[SR-228/AK-v1gc] after a restart of the app with a past connection recorded and none running: grey, with the client connected last", async () => {
  const first = await launchApp(FIXTURE);
  running = first;
  await ready(first.window);
  const server = first.mcpRaw();
  await initialized(server, { name: "Cursor", version: "1" });
  await expect(agent(first.window)).toHaveText("Agent connected");
  await server.close();
  await expect(agent(first.window)).toHaveText("No agent connected");
  await first.close({ keep: true });
  running = await launchApp(undefined, { kept: first.kept });
  const { window } = running;
  await ready(window);
  await expect(agent(window)).toHaveText("No agent connected");
  const { last } = await agentsOf(running);
  await expect(agent(window)).toHaveAttribute(
    "title",
    `Cursor · last connected ${localTime(last?.at ?? "")}`,
  );
});
