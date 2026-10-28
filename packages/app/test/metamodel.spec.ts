// The metamodel as a graph and as text (SR-130) on the built app, on fixtures/SR-130/metamodel: "Show
// metamodel" in the command prompt opens it (AK1); every type is a box with its name, prefix and
// properties, every inheritance and relation kind a labelled curve, as `logreq metamodel get` gives them
// (AK2); a relation kind open on a side appears once per type of the other side, at "Any type", with the
// open side in its label (AK3); the arrows move between the boxes, and Ctrl/Cmd+T switches between graph
// and text (AK4); the text names every type's key, name, prefix, parent, properties with value kind and
// "required" and statuses, and every relation kind's source and target types (AK5), the same that the CLI
// and the MCP server give (AK6). What the window shows is compared with the CLI's output for the same
// workspace (SR-080), mapped by this test itself, never through the app's modules.
// Keys use ControlOrMeta, so the same tests run on Linux and macOS.
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

interface Metamodel {
  readonly types: readonly {
    readonly key: string;
    readonly name: string;
    readonly prefix: string;
    readonly extends?: string;
    readonly abstract: boolean;
    readonly properties: readonly string[];
    readonly required: readonly string[];
    readonly statuses: readonly string[];
  }[];
  readonly properties: readonly {
    readonly key: string;
    readonly name: string;
    readonly kind: string;
    readonly many?: boolean;
    readonly "target-types"?: readonly string[];
  }[];
  readonly relations: readonly {
    readonly key: string;
    readonly name: string;
    readonly "source-types"?: readonly string[];
    readonly "target-types"?: readonly string[];
  }[];
  readonly statuses: readonly { readonly key: string; readonly name: string }[];
}

/** What the CLI gives for `metamodel get`. */
const metamodel = async (running: RunningApp): Promise<Metamodel> => {
  const result = await running.cli(["metamodel", "get"]);
  expect(result.code).toBe(0);
  return JSON.parse(result.stdout) as Metamodel;
};

/** Ctrl/Cmd+Shift+P, "sm", Enter on "Show metamodel"; waits until the graph has the focus and `boxes` boxes. */
const showMetamodel = async (window: Page, boxes: number): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type("sm");
  await expect(window.locator('.candidates [aria-selected="true"] .name')).toHaveText("Show metamodel");
  await window.keyboard.press("Enter");
  await expect(window.locator(".metamodel")).toBeFocused();
  await expect(window.locator(".metamodel")).toHaveAttribute("data-laid-out", String(boxes));
};

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What one box of the window shows, and where it stands. */
interface ShownBox {
  readonly key: string;
  readonly head: readonly string[];
  readonly properties: readonly string[];
  readonly box: Box;
}

const shownBoxes = (window: Page): Promise<ShownBox[]> =>
  window.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".mm-type")].map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        key: element.dataset["type"] ?? (element.dataset["any"] === undefined ? "?" : "any"),
        head: [...element.querySelectorAll(".mm-head > span")].map((part) => part.textContent),
        properties: [...element.querySelectorAll<HTMLElement>(".mm-property")].map(
          (line) => `${line.textContent}${line.classList.contains("inherited") ? " (inherited)" : ""}`,
        ),
        box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    }),
  );

/** The label lines of the window as "source > target: line", one entry per line. */
const shownLines = (window: Page): Promise<string[]> =>
  window.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".mm-label")].flatMap((label) =>
      [...label.querySelectorAll(".mm-line")].map(
        (line) => `${label.dataset["source"] ?? ""} > ${label.dataset["target"] ?? ""}: ${line.textContent}`,
      ),
    ),
  );

/** The boxes as the CLI's output says they must be: name, "abstract", prefix, properties (inherited ones marked). */
const expectedBoxes = (model: Metamodel): Omit<ShownBox, "box">[] => {
  const names = new Map(model.properties.map((property) => [property.key, property.name]));
  const byKey = new Map(model.types.map((type) => [type.key, type]));
  const boxes = model.types.map((type) => {
    const parent = type.extends === undefined ? [] : (byKey.get(type.extends)?.properties ?? []);
    return {
      key: type.key,
      head: [type.name, ...(type.abstract ? ["abstract"] : []), type.prefix],
      properties: type.properties.map(
        (key) => `${names.get(key) ?? key}${parent.includes(key) ? " (inherited)" : ""}`,
      ),
    };
  });
  return [...boxes, { key: "any", head: ["Any type"], properties: [] }];
};

/** The label lines as the CLI's output says they must be: the inheritance, each pair of each relation kind and relation property. */
const expectedLines = (model: Metamodel): string[] => {
  const node = (key: string): string => `type:${key}`;
  const side = (keys: readonly string[] | undefined): string[] =>
    keys === undefined ? ["any"] : keys.map(node);
  const byKey = new Map(model.types.map((type) => [type.key, type]));
  const inheritance = model.types.flatMap((type) =>
    type.extends === undefined ? [] : [`${node(type.key)} > ${node(type.extends)}: extends`],
  );
  const kinds = model.relations.flatMap((kind) => {
    const source = kind["source-types"] === undefined;
    const target = kind["target-types"] === undefined;
    const hint =
      source && target
        ? " · any source and target"
        : source
          ? " · any source"
          : target
            ? " · any target"
            : "";
    return side(kind["source-types"]).flatMap((from) =>
      side(kind["target-types"]).map((to) => `${from} > ${to}: ${kind.name}${hint}`),
    );
  });
  const properties = model.types.flatMap((type) => {
    const parent = type.extends === undefined ? [] : (byKey.get(type.extends)?.properties ?? []);
    return model.properties
      .filter((property) => property.kind === "relation" && type.properties.includes(property.key))
      .filter((property) => !parent.includes(property.key))
      .flatMap((property) =>
        side(property["target-types"]).map(
          (to) =>
            `${node(type.key)} > ${to}: ${property.name}${property["target-types"] === undefined ? " · any target" : ""}`,
        ),
      );
  });
  return [...inheritance, ...kinds, ...properties].sort();
};

const SPEC = fileURLToPath(new URL("../../../spec", import.meta.url));

/**
 * What the drawing cuts or covers: a name or property line wider than its box, a label line wider than
 * its label, and a label that overlaps a box or another label (review S2 of #631: the widths come from
 * the window's fonts).
 */
const drawingProblems = (window: Page): Promise<string[]> =>
  window.evaluate(() => {
    const cut = [...document.querySelectorAll<HTMLElement>(".mm-name, .mm-property")]
      .filter((line) => line.scrollWidth > line.clientWidth)
      .map((line) => `cut: ${line.textContent}`);
    const labels = [...document.querySelectorAll<HTMLElement>(".mm-label")];
    // By the edges (review R2 S2 of #631): a line wider than the label's content starts at its padding
    // and sticks out on the right, past the rectangle the overlap check below uses.
    const wide = labels.flatMap((label) => {
      const edges = label.getBoundingClientRect();
      return [...label.querySelectorAll<HTMLElement>(".mm-line")]
        .filter((line) => {
          const box = line.getBoundingClientRect();
          return box.right > edges.right + 0.5 || box.left < edges.left - 0.5;
        })
        .map((line) => `wider than its label: ${line.textContent}`);
    });
    const name = (element: HTMLElement): string =>
      element.classList.contains("mm-label")
        ? `label ${element.dataset["source"] ?? ""} > ${element.dataset["target"] ?? ""}`
        : `box ${element.dataset["type"] ?? "any"}`;
    const overlap = (a: DOMRect, b: DOMRect): boolean =>
      a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    const areas = [...labels, ...document.querySelectorAll<HTMLElement>(".mm-type")];
    const covered = labels.flatMap((label, index) =>
      areas
        .slice(index + 1)
        .filter((other) => overlap(label.getBoundingClientRect(), other.getBoundingClientRect()))
        .map((other) => `${name(label)} over ${name(other)}`),
    );
    return [...cut, ...wide, ...covered];
  });

/**
 * One row of the text as words, its lines joined by " | ": the head, "extends …", "Properties", one line
 * per property (name, key, value kind, "required", "(inherited)"), "Statuses …".
 */
const shownText = (window: Page): Promise<string[]> =>
  window.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".mm-row")].map((row) =>
      [
        [...row.querySelectorAll(".mm-text-head > span")].map((part) => part.textContent).join(" "),
        ...[
          ...row.querySelectorAll("[data-parent], [data-properties], .mm-text-property, [data-statuses]"),
        ].map((line) =>
          line.classList.contains("mm-text-property")
            ? [
                ...[...line.children].map((part) => part.textContent),
                line.classList.contains("inherited") ? "(inherited)" : "",
              ]
                .filter((part) => part !== "")
                .join(" ")
            : line.textContent,
        ),
      ].join(" | "),
    ),
  );

/** The rows of the text as the CLI's output says they must be (AK5), mapped here, not by the app. */
const expectedText = (model: Metamodel): string[] => {
  const typeNames = new Map(model.types.map((type) => [type.key, type.name]));
  const statusNames = new Map(model.statuses.map((status) => [status.key, status.name]));
  const properties = new Map(model.properties.map((property) => [property.key, property]));
  const byKey = new Map(model.types.map((type) => [type.key, type]));
  const side = (keys: readonly string[] | undefined): string =>
    keys === undefined
      ? "any type"
      : keys.length === 0
        ? "none"
        : keys.map((key) => typeNames.get(key) ?? key).join(", ");
  const types = model.types.map((type) => {
    const parent = type.extends === undefined ? [] : (byKey.get(type.extends)?.properties ?? []);
    const lines = type.properties.map((key) => {
      const property = properties.get(key);
      const kind = `${property?.many === true ? "list of " : ""}${property?.kind ?? ""}`;
      const value = property?.kind === "relation" ? `${kind} → ${side(property["target-types"])}` : kind;
      return [
        property?.name ?? key,
        key,
        value,
        type.required.includes(key) ? "required" : "",
        parent.includes(key) ? "(inherited)" : "",
      ]
        .filter((part) => part !== "")
        .join(" ");
    });
    return [
      `${type.name} ${type.prefix} ${type.key}${type.abstract ? " abstract" : ""}`,
      ...(type.extends === undefined ? [] : [`extends ${typeNames.get(type.extends) ?? type.extends}`]),
      type.properties.length === 0 ? "Properties none" : "Properties",
      ...lines,
      `Statuses ${type.statuses.length === 0 ? "none" : type.statuses.map((key) => statusNames.get(key) ?? key).join(" · ")}`,
    ].join(" | ");
  });
  const kinds = model.relations.map(
    (kind) => `${kind.name} ${kind.key} ${side(kind["source-types"])} → ${side(kind["target-types"])}`,
  );
  return [...types, ...kinds];
};

/** The selected box is the one of the type `key`. */
const expectSelected = async (window: Page, key: string): Promise<void> => {
  await expect(window.locator('.mm-type[aria-selected="true"]')).toHaveAttribute("data-type", key);
};

test.describe("the metamodel on a fixture workspace", () => {
  let running: RunningApp;
  const launch = async (): Promise<RunningApp> => {
    running = await launchApp({ fixture: "SR-130/metamodel" });
    await expect(running.window.getByLabel("Modeline")).toContainText("Weather station", { timeout: 0 });
    return running;
  };
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-130/AK1] choosing Show metamodel in the command prompt opens a buffer with the metamodel as a graph", async () => {
    const { window } = await launch();
    await showMetamodel(window, 6);
    const modeline = window.getByLabel("Modeline");
    await expect(modeline).toContainText("Metamodel");
    await expect(modeline).toContainText("5 types");
    await expect(window.locator(".buffer.result")).toHaveCount(0);
    await expect(window.locator("path.mm-edge")).toHaveCount(10);
    // Not offered on the metamodel itself; from another buffer it brings the open one back.
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("Show metamodel");
    await expect(window.locator(".candidates .name", { hasText: /^Show metamodel$/ })).toHaveCount(0);
    await window.keyboard.press("Escape");
  });

  test("[SR-130/AK2] every type is a box with name, prefix and properties and every inheritance and relation kind a labelled curve, as logreq metamodel get gives them", async () => {
    const { window } = await launch();
    const model = await metamodel(running);
    await showMetamodel(window, model.types.length + 1);
    const boxes = await shownBoxes(window);
    expect(boxes.map(({ key, head, properties }) => ({ key, head, properties }))).toEqual(
      expectedBoxes(model),
    );
    expect((await shownLines(window)).sort()).toEqual(expectedLines(model));
    // Every parent stands above its subtypes.
    const at = new Map(boxes.map((shown) => [shown.key, shown.box]));
    for (const type of model.types.filter((candidate) => candidate.extends !== undefined)) {
      const parent = at.get(type.extends ?? "");
      const child = at.get(type.key);
      expect((parent?.y ?? Number.NaN) + (parent?.height ?? 0), type.key).toBeLessThan(
        child?.y ?? Number.NaN,
      );
    }
    // Every curve ends in an arrowhead at its target.
    const markers = await window
      .locator("path.mm-edge")
      .evaluateAll((paths) => paths.map((path) => path.getAttribute("marker-end")));
    expect(markers.every((marker) => marker?.startsWith("url(#mm-arrow") === true)).toBe(true);
    // No name or property line is cut, no label line is wider than its label, no label covers anything.
    expect(await drawingProblems(window)).toEqual([]);
  });

  test("[SR-130/AK3] a relation kind open on a side appears once, at Any type", async () => {
    const { window } = await launch();
    await showMetamodel(window, 6);
    const lines = await shownLines(window);
    const of = (name: string): string[] => lines.filter((line) => line.includes(`: ${name}`));
    expect(of("Based on")).toEqual(["any > type:decision: Based on · any source"]);
    expect(of("Traces to")).toEqual(["type:decision > any: Traces to · any target"]);
    expect(of("Refines")).toEqual(["any > any: Refines · any source and target"]);
    // Open source, two target types: once per target type (#619 Q2).
    expect(of("Concerns").sort()).toEqual([
      "any > type:decision: Concerns · any source",
      "any > type:requirement: Concerns · any source",
    ]);
    // An empty list allows no type: no curve.
    expect(of("Blocks")).toEqual([]);
    await expect(window.locator("[data-any] .mm-name")).toHaveText("Any type");
  });

  test("[SR-130/AK4] arrows move between the boxes of the metamodel graph", async () => {
    const { window } = await launch();
    await showMetamodel(window, 6);
    await expectSelected(window, "item");
    await window.keyboard.press("ArrowDown");
    await expectSelected(window, "requirement");
    await window.keyboard.press("ArrowRight");
    await expectSelected(window, "decision");
    await window.keyboard.press("PageUp");
    await expectSelected(window, "item");
    await window.keyboard.press("ArrowDown");
    await window.keyboard.press("ArrowDown");
    await expectSelected(window, "software-requirement");
    await window.keyboard.press("Home");
    await expectSelected(window, "item");
    await expect(window.locator(".metamodel")).toHaveAttribute("aria-activedescendant", "mm-type-0");
  });

  test("[SR-130/AK4] Ctrl/Cmd+T switches between graph and text and keeps the selected type, by keys only", async () => {
    const { window } = await launch();
    const modeline = window.getByLabel("Modeline");
    await showMetamodel(window, 6);
    await window.keyboard.press("ArrowDown");
    await window.keyboard.press("ArrowRight");
    await expectSelected(window, "decision");
    await window.keyboard.press("ControlOrMeta+T");
    await expect(window.locator(".metamodel-text")).toBeFocused();
    await expect(window.locator(".metamodel-text")).toHaveAttribute("data-rows", "13");
    await expect(window.locator(".metamodel")).toHaveCount(0);
    await expect(window.locator('.mm-row[aria-selected="true"]')).toHaveAttribute(
      "data-row",
      "type:decision",
    );
    await expect(modeline).toContainText("Metamodel · text");
    await expect(modeline).toContainText("5 types");
    // The text opens on the selected type.
    await expect(window.locator('.mm-row[aria-selected="true"]')).toBeInViewport();
    // Down, then a relation kind, which has no box: the graph keeps the type selected last.
    await window.keyboard.press("ArrowDown");
    await expect(window.locator('.mm-row[aria-selected="true"]')).toHaveAttribute("data-row", "type:package");
    await window.keyboard.press("ArrowDown");
    await expect(window.locator('.mm-row[aria-selected="true"]')).toHaveAttribute(
      "data-row",
      "relation:derives-from",
    );
    await window.keyboard.press("ControlOrMeta+T");
    await expect(window.locator(".metamodel")).toBeFocused();
    await expect(window.locator(".metamodel")).toHaveAttribute("data-laid-out", "6");
    await expectSelected(window, "package");
    await expect(window.locator('.mm-type[aria-selected="true"]')).toBeInViewport();
    await expect(modeline).not.toContainText("Metamodel · text");
    // A type selected in the graph is the row of the text; the text keys move through its rows.
    await window.keyboard.press("Home");
    await expectSelected(window, "item");
    await window.keyboard.press("ControlOrMeta+T");
    await expect(window.locator('.mm-row[aria-selected="true"]')).toHaveAttribute("data-row", "type:item");
    await window.keyboard.press("End");
    await expect(window.locator('.mm-row[aria-selected="true"]')).toHaveAttribute(
      "data-row",
      "relation:blocks",
    );
    await window.keyboard.press("Home");
    await window.keyboard.press("Control+N");
    await expect(window.locator('.mm-row[aria-selected="true"]')).toHaveAttribute(
      "data-row",
      "type:requirement",
    );
    await window.keyboard.press("ControlOrMeta+T");
    await expectSelected(window, "requirement");
  });

  test("[SR-130/AK5] the text names every type's key, name, prefix, parent, properties with value kind and required and statuses, and every relation kind's source and target types, as logreq metamodel get gives them", async () => {
    const { window } = await launch();
    const model = await metamodel(running);
    await showMetamodel(window, model.types.length + 1);
    await window.keyboard.press("ControlOrMeta+T");
    await expect(window.locator(".metamodel-text")).toHaveAttribute(
      "data-rows",
      String(model.types.length + model.relations.length),
    );
    expect(await shownText(window)).toEqual(expectedText(model));
  });

  test("[SR-130/AK6] the app shows the types, parents, properties, statuses and relation kinds that the CLI and the MCP server give", async () => {
    const { window } = await launch();
    const fromCli = await metamodel(running);
    const agent = await running.mcp();
    try {
      expect(await agent.call("metamodel_get", {})).toEqual(fromCli);
    } finally {
      await agent.close();
    }
    await showMetamodel(window, fromCli.types.length + 1);
    await window.keyboard.press("ControlOrMeta+T");
    await expect(window.locator(".metamodel-text")).toHaveAttribute(
      "data-rows",
      String(fromCli.types.length + fromCli.relations.length),
    );
    expect(await shownText(window)).toEqual(expectedText(fromCli));
  });
});

test("[SR-130/AK2] on the specification every name, property and label line can be read whole, and the text names what the CLI gives", async () => {
  const running = await launchApp({ folder: SPEC });
  try {
    const { window } = running;
    await expect(window.getByLabel("Modeline")).toContainText("elements", { timeout: 0 });
    const model = await metamodel(running);
    await showMetamodel(window, model.types.length + 1);
    expect(await drawingProblems(window)).toEqual([]);
    // The text of the specification's own metamodel, as the CLI gives it (AK5).
    await window.keyboard.press("ControlOrMeta+T");
    await expect(window.locator(".metamodel-text")).toHaveAttribute(
      "data-rows",
      String(model.types.length + model.relations.length),
    );
    expect(await shownText(window)).toEqual(expectedText(model));
  } finally {
    await running.close();
  }
});
