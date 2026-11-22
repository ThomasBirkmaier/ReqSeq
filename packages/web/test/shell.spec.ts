// The foundation every page stands on: the token from the address, the headers of every call, the one event
// stream of the browser, and a change of the workspace outside the page.
import { drawn, expect, test } from "./fixtures.js";

test("the page takes the token from the address and keeps it out of every request line", async ({
  page,
  ui,
}) => {
  const urls: string[] = [];
  const headers: Record<string, string>[] = [];
  page.on("request", (r) => {
    urls.push(r.url());
    if (new URL(r.url()).pathname.startsWith("/api/")) {
      headers.push(r.headers());
    }
  });
  await page.goto(ui.server.url);
  await drawn(page, "/q/overview");
  expect(page.url()).not.toContain(ui.server.token);
  expect(await page.evaluate(() => sessionStorage.getItem("reqseq.token"))).toBe(ui.server.token);
  expect(urls.filter((u) => u.includes(ui.server.token))).toEqual([]);
  expect(headers.length).toBeGreaterThan(0);
  for (const h of headers) {
    expect(h["authorization"]).toBe(`Bearer ${ui.server.token}`);
  }
  expect(headers.filter((h) => h["x-reqseq-workspace"] !== undefined).length).toBe(headers.length - 1);
});

test("without a token the page says what to open and calls nothing", async ({ page, ui }) => {
  const calls: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/")) {
      calls.push(r.url());
    }
  });
  await page.goto(ui.server.url.replace(/#.*$/, ""));
  await expect(
    page.getByRole("heading", { level: 1, name: "Open the address reqseq ui printed" }),
  ).toBeVisible();
  expect(calls).toEqual([]);
});

test("a refused token gets the same message", async ({ page, ui }) => {
  await page.goto(ui.server.url.replace(/#token=.*$/, "#token=not-the-token"));
  await expect(
    page.getByRole("heading", { level: 1, name: "Open the address reqseq ui printed" }),
  ).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("reqseq.token"))).toBeNull();
});

test("the tabs of a browser share one event stream", async ({ context, ui }) => {
  const streams: string[] = [];
  context.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/events") {
      streams.push(r.url());
    }
  });
  const first = await context.newPage();
  await first.goto(ui.server.url);
  await drawn(first, "/q/overview");
  // A second tab gets the generation of the open workspace from the first one.
  const second = await context.newPage();
  await second.goto(ui.server.url);
  await drawn(second, "/q/overview");
  expect(streams).toHaveLength(1);
  // When the first tab closes, the second one reads the stream.
  await first.close();
  await expect.poll(() => streams.length).toBe(2);
});

test("a change outside the page shows without a reload", async ({ page, open, ui }) => {
  const { partial = [] } = await ui.run("element.list", { limit: 1, fields: ["identifier", "title"] });
  const target = partial[0];
  if (target === undefined) {
    throw new Error("The workspace has no element");
  }
  const ref = target.identifier ?? target.shortId;
  await open(`/e/${encodeURIComponent(ref)}`);
  const before = await ui.run("element.get", { ref });
  const changed = `${before.element.title} (changed outside)`;
  await ui.run("element.update", { ref, title: changed, expectedFileSha256: before.fileSha256 });
  try {
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
