// The mode „Agent folgen“ (SR-117) on the built app: a real `reqseq mcp` child on the same copy and with
// the same cache folder is the agent (`running.mcp()` of `support/app.ts`). The app watches the activity
// file of the copy in its core process and the window shows the element of each access while the mode is
// on.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { McpSession, RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

const FIXTURE = { fixture: "SR-069/filter" };
const SEE = { id: "69069069-0000-4000-8000-0000000000a1", title: "See the wind" };
const WARN = { id: "69069069-0000-4000-8000-0000000000a2", title: "Warn of storms" };
const MEASURE = { id: "69069069-0000-4000-8000-0000000000b1", title: "Measure wind speed" };

/** AK1: „nach höchstens 1 Sekunde“. */
const LIMIT_MS = 1000;

const title = (window: Page) => window.locator("article h1");
const modeline = (window: Page) => window.locator('[aria-label="Modeline"]');

const ready = async (window: Page): Promise<void> => {
  await window.locator('[aria-label="Sheet"] > *').first().waitFor();
};

const runCommand = async (window: Page, command: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(command);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(command);
  await window.keyboard.press("Enter");
};

/** Opens an element as a person does: Ctrl/Cmd+P and its title. */
const open = async (window: Page, name: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(name);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(name);
  await window.keyboard.press("Enter");
  await expect(title(window)).toHaveText(name);
};

/** What the window noted of one access: its time (`at`, core's clock) and when its title was painted. */
interface Probe {
  readonly at?: string;
  readonly shown?: number;
}

/**
 * Notes in the window, before a call: the `at` of the next access to element `id` (any element when
 * undefined: a created one) as the bridge delivers it, and the epoch time of the frame after `article h1`
 * shows `text`. Both clocks are this machine's, so the difference is AK1's interval: from the agent's read
 * or change to what the window shows, without the agent's own processing, the stdio pipes or Playwright's
 * polling.
 */
const arm = (window: Page, id: string | undefined, text: string): Promise<void> =>
  window.evaluate(
    ({ id, text }) => {
      interface Access {
        readonly at: string;
        readonly element: { readonly id: string };
      }
      const page = window as unknown as {
        reqseq: { on: (event: string, listener: (access: Access) => void) => () => void };
        followProbe?: { at?: string; shown?: number };
        followDisarm?: () => void;
      };
      page.followDisarm?.();
      const probe: { at?: string; shown?: number } = {};
      page.followProbe = probe;
      const off = page.reqseq.on("agent-activity", (access) => {
        if (probe.at === undefined && (id === undefined || access.element.id === id)) {
          probe.at = access.at;
        }
      });
      const observer = new MutationObserver(() => {
        if (document.querySelector("article h1")?.textContent === text) {
          observer.disconnect();
          requestAnimationFrame(() => {
            probe.shown = performance.timeOrigin + performance.now();
          });
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      page.followDisarm = () => {
        off();
        observer.disconnect();
      };
    },
    { id, text },
  );

/**
 * Sends a tool call and gives the agent's answer time (from the test) and AK1's interval measured in the
 * window (from the access to the painted title); it fails when the window shows nothing within 10 s.
 */
const shownAfter = async (
  window: Page,
  agent: McpSession,
  tool: string,
  input: Record<string, unknown>,
  shown: string,
  id: string | undefined,
): Promise<{ readonly answer: number; readonly fromAccess: number }> => {
  await arm(window, id, shown);
  const start = Date.now();
  await agent.call(tool, input);
  const answer = Date.now() - start;
  const probe = (): Promise<Probe> =>
    window.evaluate(() => (window as unknown as { followProbe: Probe }).followProbe);
  await expect.poll(async () => (await probe()).shown !== undefined, { timeout: 10_000 }).toBe(true);
  const { at, shown: painted } = await probe();
  expect(at).toBeDefined();
  return { answer, fromAccess: (painted ?? 0) - Date.parse(at ?? "") };
};

/** As `shownAfter`, and AK1: „nach höchstens 1 Sekunde“ from the access. */
const shownWithin = async (
  window: Page,
  agent: McpSession,
  tool: string,
  input: Record<string, unknown>,
  shown: string,
  id: string | undefined,
): Promise<{ readonly answer: number; readonly fromAccess: number }> => {
  const times = await shownAfter(window, agent, tool, input, shown, id);
  expect(times.fromAccess).toBeLessThanOrEqual(LIMIT_MS);
  await expect(title(window)).toHaveText(shown);
  return times;
};

/**
 * The app and an agent on its copy. The agent has read MEASURE already, before the mode is on: turning the
 * mode on shows it (assumption Q3).
 */
const started = async (): Promise<{ running: RunningApp; agent: McpSession }> => {
  const running = await launchApp(FIXTURE);
  await ready(running.window);
  const agent = await running.mcp();
  await agent.call("element_get", { ref: MEASURE.id });
  return { running, agent };
};

const finish = async (running: RunningApp, agent: McpSession): Promise<void> => {
  await agent.close();
  await running.close();
};

test("[SR-117/AK1] following, an MCP element_get, element_update and element_create each show their element within 1 s", async () => {
  const { running, agent } = await started();
  const { window } = running;
  try {
    await window.keyboard.press("ControlOrMeta+Shift+O");
    await expect(modeline(window)).toContainText("following agent");
    // Turned on, the app shows the element accessed last at once (assumption Q3).
    await expect(title(window)).toHaveText(MEASURE.title);
    const read = await shownWithin(window, agent, "element_get", { ref: SEE.id }, SEE.title, SEE.id);
    // A change: the new title, not the old state.
    const changed = await shownWithin(
      window,
      agent,
      "element_update",
      { ref: WARN.id, title: "Warn of gales" },
      "Warn of gales",
      WARN.id,
    );
    const created = await shownWithin(
      window,
      agent,
      "element_create",
      { type: "need", title: "Count the gusts" },
      "Count the gusts",
      undefined,
    );
    // The mode closed the buffers it opened before: one is left, next to the overview.
    await window.keyboard.press("ControlOrMeta+P");
    await expect(window.locator('.candidates [role="option"]').first()).toBeVisible();
    const names = await window.locator('.candidates [role="option"]').allTextContents();
    expect(names.filter((name) => name.includes(SEE.title) || name.includes("Warn of gales"))).toEqual([]);
    await window.keyboard.press("Escape");
    // eslint-disable-next-line no-console -- the times are the result of this test, the PR quotes them.
    console.log(
      `PERF follow-agent ${JSON.stringify({ read, update: changed, create: created })} (answer: call to the agent's answer; fromAccess: the access to the painted title, AK1)`,
    );
  } finally {
    await finish(running, agent);
  }
});

test("[SR-117/AK2] not following, MCP reads leave the shown buffer as it was; after a restart of the app the mode is off", async () => {
  const { running, agent } = await started();
  const { window } = running;
  let restarted: RunningApp | undefined;
  try {
    await open(window, MEASURE.title);
    await agent.call("element_get", { ref: SEE.id });
    await agent.call("element_update", { ref: WARN.id, title: "Warn of gales" });
    // Longer than AK1 allows: nothing moved.
    await window.waitForTimeout(LIMIT_MS + 500);
    await expect(title(window)).toHaveText(MEASURE.title);
    await expect(modeline(window)).not.toContainText("following agent");
    // On, then a restart of the app: off again.
    await window.keyboard.press("ControlOrMeta+Shift+O");
    await expect(modeline(window)).toContainText("following agent");
    await agent.close();
    await running.close({ keep: true });
    restarted = await launchApp(undefined, { kept: running.kept });
    await ready(restarted.window);
    await expect(modeline(restarted.window)).toContainText("Weather station");
    await expect(modeline(restarted.window)).not.toContainText("following agent");
    const again = await restarted.mcp();
    try {
      await again.call("element_get", { ref: MEASURE.id });
      await restarted.window.waitForTimeout(LIMIT_MS + 500);
      await expect(title(restarted.window)).toHaveCount(0);
    } finally {
      await again.close();
    }
  } finally {
    await agent.close();
    await (restarted ?? running).close();
  }
});

test('[SR-117/AK3] the modeline shows "following agent" while the mode is on', async () => {
  const { running, agent } = await started();
  const { window } = running;
  try {
    await expect(modeline(window)).not.toContainText("following agent");
    await window.keyboard.press("ControlOrMeta+Shift+O");
    await expect(modeline(window).locator(".workspace .segment").last()).toHaveText("following agent");
    await window.keyboard.press("ControlOrMeta+Shift+O");
    await expect(modeline(window)).not.toContainText("following agent");
  } finally {
    await finish(running, agent);
  }
});

test("[SR-117/AK4] the mode switches by the command prompt and by the key, and the MCP tool list offers nothing for it", async () => {
  const { running, agent } = await started();
  const { window } = running;
  try {
    expect((await agent.tools()).filter((name) => /follow/i.test(name))).toEqual([]);
    await runCommand(window, "Follow agent");
    await expect(modeline(window)).toContainText("following agent");
    await runCommand(window, "Stop following agent");
    await expect(modeline(window)).not.toContainText("following agent");
    await window.keyboard.press("ControlOrMeta+Shift+O");
    await expect(modeline(window)).toContainText("following agent");
    // The key does not open a workspace (File > Open Workspace is Ctrl/Cmd+O).
    expect(running.app.windows()).toHaveLength(1);
    await window.keyboard.press("ControlOrMeta+Shift+O");
    await expect(modeline(window)).not.toContainText("following agent");
  } finally {
    await finish(running, agent);
  }
});

test("[SR-117/AK5] with unsaved text an MCP read of another element does not switch the view until the input is saved", async () => {
  const { running, agent } = await started();
  const { window } = running;
  try {
    await window.keyboard.press("ControlOrMeta+Shift+O");
    await expect(modeline(window)).toContainText("following agent");
    await shownWithin(window, agent, "element_get", { ref: SEE.id }, SEE.title, SEE.id);
    await window.keyboard.press("Enter");
    await window.keyboard.type(" More");
    await agent.call("element_get", { ref: MEASURE.id });
    // The user keeps typing: the input is not saved (SR-105 saves a second after the last key), so the
    // view stays longer than the follow would take.
    const until = Date.now() + LIMIT_MS + 500;
    while (Date.now() < until) {
      await window.keyboard.type(".");
      await window.waitForTimeout(300);
      await expect(title(window)).toHaveText(SEE.title, { timeout: 100 });
    }
    await expect(modeline(window)).toContainText("following agent: waits for save");
    // Once the typing stops, the input is saved, and then the view follows.
    await expect(title(window)).toHaveText(MEASURE.title, { timeout: 5000 });
    await expect(modeline(window)).not.toContainText("waits for save");
    const saved = await running.cli(["element", "get", SEE.id]);
    expect(saved.stdout).toContain(" More.");
  } finally {
    await finish(running, agent);
  }
});

test("[SR-117/AK6] following makes no request", async () => {
  const { running, agent } = await started();
  const { window } = running;
  try {
    await window.keyboard.press("ControlOrMeta+Shift+O");
    await expect(modeline(window)).toContainText("following agent");
    await shownWithin(window, agent, "element_get", { ref: SEE.id }, SEE.title, SEE.id);
    await shownWithin(window, agent, "element_get", { ref: MEASURE.id }, MEASURE.title, MEASURE.id);
    expect(running.stderr()).not.toContain("Blocked a request");
    expect(running.stderr()).not.toContain("Agents cannot be followed");
    // The agent runs with the network blocked: it would fail on a connection.
    expect(agent.stderr()).not.toContain("network access blocked");
  } finally {
    await finish(running, agent);
  }
});
