// SR-248 AK5 and SR-078 AK3: element content runs nothing and loads nothing. An element of its own holds, in its
// title, its text, a Markdown property and a plain property: raw HTML with scripts and event attributes, links of
// other schemes than http, https and mailto, images from another machine, from `data:` and from outside the
// repository, inline SVG with a script, an event attribute and addresses it would load, and a Mermaid diagram
// with click actions and an HTML label. Every request of the browser context to an address other than loopback
// is refused and recorded (SR-078 AK3); the UI server runs in the network namespace of the job (ci.yml).
import fs from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
import type { Ui } from "./fixtures.js";
import { drawn, expect, test as base } from "./fixtures.js";
import { isLoopback, refuseRemote } from "./contract.js";
import { PAGES, createWorkspace, runOn, startUi } from "./start-ui.js";

/** The element that holds the hostile content: its ID, and the route of its page. */
interface Hostile {
  readonly id: string;
  readonly ref: string;
}

const test = base.extend<object, { ui: Ui; hostile: Hostile }>({
  ui: [
    async ({ kind }, use) => {
      const workspace = await createWorkspace(kind);
      const server = await startUi(workspace.root);
      await use({ server, root: workspace.root, run: runOn(workspace.root) });
      await server.close();
      await workspace.cleanup();
    },
    { scope: "worker" },
  ],
  hostile: [
    async ({ ui }, use) => {
      const made = await ui.run("element.create", {
        type: "goal",
        title: TITLE,
        text: TEXT,
        properties: { motivation: MARKDOWN_PROPERTY, "success-signs": [PLAIN_PROPERTY] },
      });
      await use({ id: made.element.id, ref: made.element.identifier ?? made.element.shortId });
    },
    { scope: "worker" },
  ],
});

/** Another machine (TEST-NET-1 and a reserved name): nothing may ever reach them. */
const REMOTE = "http://192.0.2.10";
const REMOTE_NAME = "https://other.example";
/** What a payload sets when it runs. */
const RUN = "top.__reqseqRan=1;alert(1)";
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const TITLE = `Hostile <img src=x onerror="${RUN}"><script>${RUN}</script> title`;
const TEXT = [
  `Raw <script>${RUN}</script> and <img src="${REMOTE}/raw.png" onerror="${RUN}"> and <b onmouseover="${RUN}">HTML</b>.`,
  "",
  `[script link](javascript:${RUN}) [file link](file:///etc/passwd) [vb link](vbscript:msgbox) [data link](data:text/html,<script>${RUN}</script>)`,
  "",
  `![remote](${REMOTE}/remote.png) ![named](${REMOTE_NAME}/named.png) ![inline](data:image/png;base64,${PNG}) ![outside](../../../../outside.png) ![absolute](/etc/outside.png)`,
  "",
  `<svg xmlns="http://www.w3.org/2000/svg" onload="${RUN}"><script>${RUN}</script><image href="${REMOTE}/svg.png"/><use href="${REMOTE}/sprite.svg#a"/><a href="javascript:${RUN}"><text>x</text></a></svg>`,
  "",
  "```mermaid",
  "graph TD",
  `  A["<img src=x onerror=${RUN}>"] --> B`,
  "  click A call alert(1)",
  `  click B "javascript:${RUN}"`,
  `  click A href "${REMOTE}/mermaid"`,
  "```",
  "",
  `<iframe src="${REMOTE}/frame"></iframe><object data="${REMOTE}/object"></object><link rel="stylesheet" href="${REMOTE}/style.css">`,
].join("\n");
const MARKDOWN_PROPERTY = `<img src="${REMOTE_NAME}/motivation.png" onerror="${RUN}"> [why](javascript:${RUN}) ![m](${REMOTE}/m.png)`;
const PLAIN_PROPERTY = `<script>${RUN}</script><img src="${REMOTE}/plain.png" onerror="${RUN}">`;

/** The URL paths of the page files: what the page may fetch from its server besides the commands. */
async function pageFiles(): Promise<Set<string>> {
  const files = await fs.readdir(PAGES, { recursive: true, withFileTypes: true });
  return new Set([
    "/",
    ...files
      .filter((f) => f.isFile())
      .map((f) => `/${path.relative(PAGES, path.join(f.parentPath, f.name)).split(path.sep).join("/")}`),
  ]);
}

/** Records every request of the page to its own server that is neither a page file nor a command. */
async function recordOtherFiles(page: Page): Promise<string[]> {
  const files = await pageFiles();
  const other: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const ours = ["/api/", "/ui/"].some((p) => url.pathname.startsWith(p)) || files.has(url.pathname);
    if (["http:", "https:"].includes(url.protocol) && isLoopback(url) && !ours) {
      other.push(url.href);
    }
  });
  return other;
}

/** Marks in the DOM of something that could run or load: event attributes, scripts, frames, foreign sources. */
const runnable = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const SOURCES = ["href", "xlink:href", "src", "srcset", "data", "action", "formaction", "poster"];
    /** What is wrong with one attribute: an event, a script scheme, a source other than one the page made. */
    const problem = (tag: string, name: string, value: string): string | undefined => {
      if (name.startsWith("on")) {
        return `${tag} ${name}`;
      }
      if (!SOURCES.includes(name)) {
        return undefined;
      }
      const scheme = /^([a-z][a-z0-9+.-]*):/iu.exec(value.trim())?.[1]?.toLowerCase();
      // A link may lead to http, https and mailto (it opens only on a click) or a route of the page; any other
      // source only to an image the page built itself (`blob:`) or a fragment of the page.
      if (tag === "a" && name === "href") {
        return scheme === undefined || ["http", "https", "mailto"].includes(scheme)
          ? undefined
          : `${tag} ${name}=${value}`;
      }
      const own =
        scheme === "blob" || (scheme === undefined && (value.trim() === "" || value.startsWith("#")));
      return own ? undefined : `${tag} ${name}=${value}`;
    };
    const found: string[] = [];
    for (const node of document.body.querySelectorAll("*")) {
      const tag = node.tagName.toLowerCase();
      if (["script", "iframe", "object", "embed", "link", "foreignobject"].includes(tag)) {
        found.push(`<${tag}>`);
      }
      for (const { name, value } of node.attributes) {
        const wrong = problem(tag, name.toLowerCase(), value);
        if (wrong !== undefined) {
          found.push(wrong);
        }
      }
    }
    return found;
  });

/** The pages that show the element or a command output that names it. */
const routesOf = (hostile: Hostile): string[] => [
  `/e/${encodeURIComponent(hostile.ref)}`,
  "/q/drafts",
  "/q/overview",
  "/c",
  `/graph/${encodeURIComponent(hostile.ref)}`,
];

/** Opens the address with the token, then each route in turn, each drawn. */
async function visit(page: Page, url: string, routes: readonly string[]): Promise<void> {
  await page.goto(url);
  await drawn(page, "/q/overview");
  for (const route of routes) {
    await page.evaluate((hash) => {
      location.hash = hash;
    }, route);
    await drawn(page, route.split("?")[0] ?? route);
  }
}

test("[SR-248/AK-zh0f] hostile element content is shown as text: nothing runs, nothing loads from elsewhere", async ({
  page,
  context,
  ui,
  hostile,
}) => {
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  const remote = await refuseRemote(context);
  const other = await recordOtherFiles(page);
  await visit(page, ui.server.url, []);
  for (const route of routesOf(hostile)) {
    await page.evaluate((hash) => {
      location.hash = hash;
    }, route);
    await drawn(page, route);
    // The page shows the element: the title is its text, with the markup as characters.
    await expect(page.locator("body")).toContainText("Hostile <img src=x");
    expect(await runnable(page), route).toEqual([]);
  }
  // The element page shows the texts too, as text or as allowlisted Markdown.
  await page.evaluate(
    (hash) => {
      location.hash = hash;
    },
    `/e/${encodeURIComponent(hostile.ref)}`,
  );
  await drawn(page, `/e/${encodeURIComponent(hostile.ref)}`);
  await expect(page.locator(".card")).toContainText("graph TD");
  await expect(page.locator("body")).toContainText(PLAIN_PROPERTY);
  // Time for an image, a frame or a script that would load or run late.
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as { __reqseqRan?: unknown }).__reqseqRan)).toBeUndefined();
  expect(dialogs).toEqual([]);
  expect(remote).toEqual([]);
  expect(other).toEqual([]);
});

test("[SR-078/AK-wx9y] the pages make no connection to another machine, also for an element that names one", async ({
  page,
  context,
  ui,
  hostile,
}) => {
  const remote = await refuseRemote(context);
  const { partial = [] } = await ui.run("element.list", { limit: 5, fields: ["identifier"] });
  await visit(page, ui.server.url, [
    ...routesOf(hostile),
    ...partial.map((e) => `/e/${encodeURIComponent(e.identifier ?? e.shortId)}`),
    "/q/evidence-outdated",
    "/r",
    "/evidence",
    "/matrix",
    "/w/open",
    "/w/problems",
    "/w/export",
    "/w/settings",
  ]);
  await page.waitForTimeout(500);
  expect(remote).toEqual([]);
});
