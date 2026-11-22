// Races and failures of the foundation: a page that finishes late, a lost stream, a refused token in one tab, a
// switched workspace, and the query that reads what points to an element.
import { drawn, expect, test } from "./fixtures.js";

const firstElement = async (run: Parameters<Parameters<typeof test>[2]>[0]["ui"]["run"]): Promise<string> => {
  const { partial = [] } = await run("element.list", { limit: 1, fields: ["identifier"] });
  const e = partial[0];
  if (e === undefined) {
    throw new Error("The workspace has no element");
  }
  return e.identifier ?? e.shortId;
};

test("a page that finishes after the person moved on does not draw over the new one", async ({
  page,
  ui,
}) => {
  const ref = await firstElement(ui.run);
  // The overview waits for the verification degree; meanwhile the person opens an element.
  await page.route("**/api/evidence.degree", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.goto(ui.server.url);
  await expect(page.locator("#app[aria-busy=true]")).toBeAttached();
  await page.evaluate(
    (hash) => {
      location.hash = hash;
    },
    `/e/${encodeURIComponent(ref)}`,
  );
  await drawn(page, `/e/${encodeURIComponent(ref)}`);
  await page.waitForTimeout(2000);
  await expect(page.locator("#card")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toHaveCount(0);
});

test("a change while the stream was lost shows once it is back", async ({ page, ui }) => {
  const ref = await firstElement(ui.run);
  // The first stream ends at once; the page reads it again after a pause, which the test holds until the change.
  let streams = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/events", async (route) => {
    streams += 1;
    if (streams === 1) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: 'event: workspace\ndata: {"generation":1}\n\n',
      });
      return;
    }
    await gate;
    await route.continue();
  });
  await page.goto(ui.server.url);
  await drawn(page, "/q/overview");
  const route = `/e/${encodeURIComponent(ref)}`;
  await page.evaluate((hash) => {
    location.hash = hash;
  }, route);
  await drawn(page, route);
  const before = await ui.run("element.get", { ref });
  const changed = `${before.element.title} (changed while the stream was lost)`;
  await ui.run("element.update", { ref, title: changed, expectedFileSha256: before.fileSha256 });
  try {
    await expect.poll(() => streams).toBe(2);
    release();
    await expect(page.getByRole("heading", { level: 1, name: changed })).toBeVisible();
  } finally {
    const after = await ui.run("element.get", { ref });
    await ui.run("element.update", {
      ref,
      title: before.element.title,
      expectedFileSha256: after.fileSha256,
    });
  }
});

for (const order of ["first", "second"] as const) {
  test(`a refused token logs out only its own tab (opened ${order})`, async ({ context, ui }) => {
    const wrong = ui.server.url.replace(/#token=.*$/, "#token=not-the-token");
    const refused = await context.newPage();
    const good = await context.newPage();
    if (order === "first") {
      await refused.goto(wrong);
      await good.goto(ui.server.url);
    } else {
      await good.goto(ui.server.url);
      await drawn(good, "/q/overview");
      await refused.goto(wrong);
    }
    const message = { level: 1, name: "Open the address reqseq ui printed" } as const;
    await expect(refused.getByRole("heading", message)).toBeVisible();
    await drawn(good, "/q/overview");
    await good.waitForTimeout(1000);
    await expect(good.getByRole("heading", message)).toHaveCount(0);
    await expect(good.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  });
}

test("a command refused for a switched workspace waits for the workspace event", async ({
  page,
  open,
  ui,
}) => {
  const ref = await firstElement(ui.run);
  await open();
  let refusals = 0;
  await page.route("**/api/element.get", async (route) => {
    refusals += 1;
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ code: "workspace.changed", message: "The workspace was switched" }),
    });
  });
  await page.evaluate(
    (hash) => {
      location.hash = hash;
    },
    `/e/${encodeURIComponent(ref)}`,
  );
  await page.waitForTimeout(2000);
  expect(refusals).toBe(1);
});

test("what points to an element is filtered by the server, without package members, in the view", async ({
  page,
  open,
  ui,
}) => {
  const ref = await firstElement(ui.run);
  const mm = await ui.run("metamodel.get", {});
  const packages = mm.properties.find((p) => p.meaning === "packages")?.key;
  const bodies: Record<string, unknown>[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/trace.neighbourhood")) {
      bodies.push(r.postDataJSON() as Record<string, unknown>);
    }
  });
  await open(`/e/${encodeURIComponent(ref)}`);
  expect(bodies).toHaveLength(1);
  const body = bodies[0] ?? {};
  expect(body["direction"]).toBe("down");
  expect(body["meanings"]).toEqual(["reference"]);
  expect(body["kinds"]).toEqual(expect.arrayContaining(mm.relations.map((k) => k.key)));
  if (packages !== undefined) {
    expect(body["kinds"]).not.toContain(packages);
  }
  const validity = mm.properties.some((p) => p.meaning === "validity");
  expect(body["view"]).toBe(validity ? "core" : undefined);
});
