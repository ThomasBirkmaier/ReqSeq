// SR-248 AK1: the web UI shows the values and the order of what the commands give. The UI server runs with a
// command runner (ADR-0020 "Test seam") whose outputs differ from the files of the workspace: other titles, text,
// counts and hints, in an order of their own.
import type { CommandRunner } from "@reqseq/api";
import type { InvokeContext } from "@reqseq/core";
import type { Ui } from "./fixtures.js";
import { expect, test as base } from "./fixtures.js";
import { createWorkspace, runOn, runner, startUi } from "./start-ui.js";

type Output = Record<string, unknown>;
interface Listed {
  readonly id: string;
  readonly shortId: string;
}

/** The title the runner gives the element with short ID `shortId`. */
const givenTitle = (shortId: string): string => `Given title of ${shortId}`;
const GIVEN_TEXT = "Given text that no element file holds.";
const GIVEN_DEGREE = { total: 90, verified: 41 };

/** The elements the given hints name, in the order the runner gives them (set once the workspace is known). */
let hinted: Listed[] = [];

/** The outputs of the commands the overview, a queue and the element page read, given by the test. */
const given: CommandRunner = {
  contracts: runner.contracts,
  invoke: async (name: string, input: unknown, ctx: InvokeContext): Promise<unknown> => {
    const output = (await runner.invoke(name, input, ctx)) as Output;
    switch (name) {
      case "element.list": {
        const key = output["partial"] === undefined ? "elements" : "partial";
        const rows = (output[key] as Listed[] | undefined) ?? [];
        return { ...output, [key]: rows.map((e) => ({ ...e, title: givenTitle(e.shortId) })).reverse() };
      }
      case "element.get": {
        const element = output["element"] as Output;
        return {
          ...output,
          element: { ...element, title: givenTitle(String(element["shortId"])), text: GIVEN_TEXT },
        };
      }
      case "evidence.degree": {
        const degree = output["degree"] as Output;
        return {
          ...output,
          degree: {
            ...degree,
            total: GIVEN_DEGREE.total,
            share: GIVEN_DEGREE.verified / GIVEN_DEGREE.total,
            counts: { open: 49, verified: GIVEN_DEGREE.verified, indirect: 0, failed: 0, outdated: 0 },
          },
        };
      }
      case "hint.list": {
        const offset = (input as { offset?: number }).offset ?? 0;
        const hints =
          offset > 0
            ? []
            : hinted.map((e, i) => ({
                code: "evidence.outdated",
                severity: "warning",
                message: `Given hint ${String(i + 1)}`,
                elementId: e.id,
                elementShortId: e.shortId,
                elementTitle: givenTitle(e.shortId),
              }));
        return {
          ...output,
          kinds: [{ code: "evidence.outdated", count: hints.length }],
          hints,
          ...(offset > 0 ? {} : { total: hints.length }),
        };
      }
      default:
        return output;
    }
  },
};

const test = base.extend<object, { ui: Ui }>({
  ui: [
    async ({ kind }, use) => {
      const workspace = await createWorkspace(kind);
      const run = runOn(workspace.root);
      const { partial = [] } = await run("element.list", { limit: 100, fields: ["title"] });
      // Three elements in an order of no file and no sort: the second, the last and the first listed.
      hinted = [partial[1], partial.at(-1), partial[0]].flatMap((e) =>
        e === undefined ? [] : [{ id: e.id, shortId: e.shortId }],
      );
      const server = await startUi(workspace.root, given);
      await use({ server, root: workspace.root, run });
      await server.close();
      await workspace.cleanup();
    },
    { scope: "worker" },
  ],
});

test("[SR-248/AK-r5tz] the pages show the values and the order of the commands' outputs, not of the files", async ({
  page,
  open,
  ui,
}) => {
  expect(hinted).toHaveLength(3);
  // The overview: the count of the given degree.
  await open();
  await expect(page.locator(".headline")).toHaveText(
    new RegExp(`^${String(GIVEN_DEGREE.verified)} of ${String(GIVEN_DEGREE.total)} .+ are verified\\.$`),
  );
  // A queue: the rows of the given hints, in their order, with the given titles.
  await open("/q/evidence-outdated");
  await expect(page.locator(".it .t")).toHaveText(hinted.map((e) => givenTitle(e.shortId)));
  await expect(page.locator(".it")).toHaveCount(hinted.length);
  // The element page: the given title and text, not those of the file.
  const [first] = hinted;
  const { element } = await ui.run("element.get", { ref: first?.id ?? "" });
  expect(element.title).not.toBe(givenTitle(element.shortId));
  await open(`/e/${element.identifier ?? element.shortId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(givenTitle(element.shortId));
  await expect(page.locator(".card .prose")).toHaveText(GIVEN_TEXT);
  await expect(page.locator(".card")).not.toContainText(element.title);
});
