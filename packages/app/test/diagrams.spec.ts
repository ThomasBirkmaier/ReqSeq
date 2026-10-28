// Diagrams in the editor's live preview (SR-096, #108) on the built app: typed with real keys, drawn by the
// bundled Mermaid as an image, offline, and with a syntax error the error and the source. SR-096 is
// verified by demonstration; these tests back the record. Keys use ControlOrMeta, so they run on Linux and
// macOS.
import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, listAll } from "./support/app.js";
import { DEMO_FILE, DEMO_FILES, DEMO_FRONT_MATTER, DEMO_TITLE } from "./support/demo.js";

const FIXTURE = { fixture: "SR-069/filter", files: DEMO_FILES };

const opened = async (window: Page, title: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(title);
  await expect(window.locator(".cm-content")).toBeVisible();
  await expect(window.locator("article")).toBeFocused();
};

/** Edits the text of the open element, emptied first, so every line is in the window of the test. */
const editEmpty = async (window: Page): Promise<Locator> => {
  await window.keyboard.press("Enter");
  const content = window.locator(".cm-content");
  await expect(content).toBeFocused();
  await window.keyboard.press("ControlOrMeta+a");
  await window.keyboard.press("Backspace");
  return content;
};

/** Types `lines` with real keys, one Enter between them. */
const typeLines = async (window: Page, lines: readonly string[]): Promise<void> => {
  for (const [at, line] of lines.entries()) {
    if (at > 0) {
      await window.keyboard.press("Enter");
    }
    await window.keyboard.type(line);
  }
};

/** The SVG an image of a drawing shows, decoded from its `data:` URL. */
const svgOf = async (image: Locator): Promise<string> => {
  const source = (await image.getAttribute("src")) ?? "";
  expect(source.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
  return decodeURIComponent(source.slice(source.indexOf(",") + 1));
};

/** Whether the image has loaded and has a size. */
const loaded = (image: Locator): Promise<boolean> =>
  image.evaluate((element) => {
    const img = element as HTMLImageElement;
    return img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
  });

/** The long tasks the page has seen since the observer started (see the test of large diagrams). */
const longTasks = (window: Page): Promise<{ start: number; duration: number }[]> =>
  window.evaluate(() => Reflect.get(window, "longTasks") as { start: number; duration: number }[]);

test.describe("diagrams in the editor", () => {
  let running: RunningApp;
  const consoleProblems: string[] = [];
  test.beforeEach(async () => {
    consoleProblems.length = 0;
    running = await launchApp(FIXTURE);
    running.window.on("console", (message) => {
      if (/Content Security Policy|Refused to|quirks mode/i.test(message.text())) {
        consoleProblems.push(message.text());
      }
    });
    await listAll(running.window);
  });
  test.afterEach(async () => {
    expect(consoleProblems).toEqual([]);
    // Offline (SR-078): Mermaid and its chunks come from the app's own files, nothing else is requested.
    expect(running.stderr()).not.toContain("Blocked a request");
    await running.close();
  });

  test("[SR-096/AK2] a Mermaid diagram typed in the editor appears drawn", async () => {
    const { window, workspace } = running;
    await opened(window, DEMO_TITLE);
    const content = await editEmpty(window);

    // While the cursor is in the diagram, its source shows and the drawing directly below it (A1).
    await typeLines(window, ["Ablauf:", "", "```mermaid", "flowchart TD", "Start --> Ende", "```"]);
    const image = content.locator("img.cm-lr-diagram");
    await expect(image).toBeVisible();
    await expect.poll(() => loaded(image)).toBe(true);
    expect(await svgOf(image)).toContain("Start");
    expect(await svgOf(image)).toContain("Ende");
    // Labels are SVG text, no HTML in a foreignObject (`htmlLabels: false`).
    expect(await svgOf(image)).not.toContain("<foreignObject");
    await expect(content.locator(".cm-line", { hasText: /^Start --> Ende$/ })).toHaveCount(1);

    // The drawing follows the typing.
    await window.keyboard.press("ArrowUp");
    await window.keyboard.press("End");
    await window.keyboard.type(" --> Ziel");
    await expect.poll(async () => svgOf(image)).toContain("Ziel");
    await expect(image).toHaveCount(1);

    // The cursor leaves the text: the drawing stands in place of the source.
    await window.keyboard.press("Escape");
    await expect(window.locator("article")).toBeFocused();
    await expect(content.locator(".cm-line", { hasText: "flowchart" })).toHaveCount(0);
    await expect(content.locator(".cm-line", { hasText: "```" })).toHaveCount(0);
    await expect(image).toBeVisible();
    expect(await loaded(image)).toBe(true);
    // Mermaid's measuring SVG is gone from the page.
    expect(await window.locator(".lr-diagram-measure").evaluate((element) => element.childElementCount)).toBe(
      0,
    );

    // A click on the drawing puts the cursor there: its source shows again.
    await image.click();
    await expect(content.locator(".cm-line", { hasText: "flowchart TD" })).toHaveCount(1);

    // The file holds the Markdown as typed (D-027): the preview only decorates it. Autosave writes it.
    const file = path.join((workspace as { root: string }).root, ...DEMO_FILE.split("/"));
    await expect
      .poll(() => fs.readFile(file, "utf8"))
      .toBe(`${DEMO_FRONT_MATTER}Ablauf:\n\n\`\`\`mermaid\nflowchart TD\nStart --> Ende --> Ziel\n\`\`\`\n`);
  });

  test("[SR-096/AK2] sequence and state diagrams appear drawn, in the colours of the scheme", async () => {
    const { window } = running;
    await opened(window, DEMO_TITLE);
    const content = await editEmpty(window);
    await typeLines(window, [
      "```mermaid",
      "sequenceDiagram",
      "Nutzer->>Tool: Anforderung speichern",
      "Tool-->>Nutzer: gespeichert",
      "```",
      "",
      "```mermaid",
      "stateDiagram-v2",
      "[*] --> Entwurf",
      "Entwurf --> Akzeptiert",
      "```",
      "",
    ]);
    await window.keyboard.press("Escape");
    const images = content.locator("img.cm-lr-diagram");
    await expect(images).toHaveCount(2);
    expect(await svgOf(images.nth(0))).toContain("Anforderung speichern");
    expect(await svgOf(images.nth(1))).toContain("Akzeptiert");
    await expect.poll(() => loaded(images.nth(1))).toBe(true);

    // Another colour scheme draws the diagrams again in its greys (D-062).
    const light = await svgOf(images.nth(0));
    await window.evaluate(() => {
      document.documentElement.dataset["theme"] = matchMedia("(prefers-color-scheme: dark)").matches
        ? "light"
        : "dark";
    });
    await expect.poll(async () => (await svgOf(images.nth(0))) !== light).toBe(true);
  });

  test("[SR-096/AK3] a diagram with a syntax error shows the error and its source", async () => {
    const { window } = running;
    await opened(window, DEMO_TITLE);
    const content = await editEmpty(window);
    await typeLines(window, ["```mermaid", "flowchart TD", "A -->", "```"]);
    await window.keyboard.press("Escape");
    await expect(window.locator("article")).toBeFocused();

    // The source lines stay (the fence lines are hidden as in any code block), the error is below them, in grey.
    await expect(content.locator(".cm-line", { hasText: /^flowchart TD$/ })).toHaveCount(1);
    await expect(content.locator(".cm-line", { hasText: /^A -->$/ })).toHaveCount(1);
    const error = content.locator("div.cm-lr-render-error");
    await expect(error).toContainText(/Error\s*Parse error on line \d+:/);
    await expect(content.locator("img.cm-lr-diagram")).toHaveCount(0);
    // Readable: at least 0.8 of the body text, not shrunk with the hidden fence line it ends (#747).
    const [errorSize, bodySize] = await error.evaluate((element) => [
      Number.parseFloat(getComputedStyle(element).fontSize),
      Number.parseFloat(getComputedStyle(document.body).fontSize),
    ]);
    expect(errorSize).toBeGreaterThanOrEqual(bodySize * 0.8);
    const colours = await error.evaluate((element) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--muted)";
      element.parentElement?.append(probe);
      const muted = getComputedStyle(probe).color;
      probe.remove();
      return [getComputedStyle(element).color, muted];
    });
    expect(colours[0]).toBe(colours[1]);

    // Fixed, it is drawn.
    await content.locator(".cm-line", { hasText: /^A -->$/ }).click();
    await window.keyboard.press("End");
    await window.keyboard.type(" B");
    await expect(content.locator("img.cm-lr-diagram")).toBeVisible();
    await expect(error).toHaveCount(0);
  });

  test("a diagram runs nothing from the file and keeps the app's look", async () => {
    const { window } = running;
    await opened(window, DEMO_TITLE);
    const content = await editEmpty(window);
    // Typed at once: the test is about what is drawn, not about the keys.
    await window.keyboard.insertText(
      [
        "```mermaid",
        '%%{init: {"securityLevel": "loose", "themeCSS": ".node rect { fill: #ff0000 }", "theme": "forest"}}%%',
        "flowchart TD",
        'A["<img src=x onerror=window.hacked=1>"] --> B["<script>window.hacked=2</script>"]',
        "click A call alert()",
        'click B href "javascript:window.hacked=3"',
        "```",
        "",
      ].join("\n"),
    );
    await window.keyboard.press("Escape");
    const image = content.locator("img.cm-lr-diagram");
    await expect(image).toBeVisible();
    const svg = await svgOf(image);
    expect(svg).not.toContain("#ff0000");
    expect(svg).not.toMatch(/<script|onerror=|javascript:/i);
    await image.click();
    await window.keyboard.press("Escape");
    expect(await window.evaluate(() => Reflect.get(window, "hacked") as unknown)).toBeUndefined();
    // Nothing of the diagram is in the page: one image, no link, no script, no foreign image.
    await expect(content.locator("a, script, img:not(.cm-lr-diagram)")).toHaveCount(0);
  });

  test("a formula in a diagram label: text in a flowchart, set by the bundled KaTeX in a sequence diagram", async () => {
    const { window } = running;
    await opened(window, DEMO_TITLE);
    const content = await editEmpty(window);
    await window.keyboard.insertText(
      [
        "```mermaid",
        "flowchart LR",
        'A["$$x^2$$"] --> B',
        "```",
        "",
        "```mermaid",
        "sequenceDiagram",
        "A->>B: $$x^2$$",
        "Note over A: $$\\frac{1}{2}$$",
        "```",
        "",
      ].join("\n"),
    );
    await window.keyboard.press("Escape");
    const images = content.locator("img.cm-lr-diagram");
    await expect(images).toHaveCount(2);
    for (const at of [0, 1]) {
      await expect.poll(() => loaded(images.nth(at))).toBe(true);
    }
    await expect(content.locator(".cm-lr-render-error")).toHaveCount(0);
    // Flowchart labels are SVG text (`htmlLabels: false`): the formula stays its source.
    const flowchart = await svgOf(images.nth(0));
    expect(flowchart).toContain("x^2");
    expect(flowchart).not.toContain("<math");
    // Sequence diagrams set it with KaTeX (the one copy of the app, `mermaid>katex` override) as MathML.
    expect(await svgOf(images.nth(1))).toContain("<math");
  });

  test("diagrams over the limits show the limit as their error", async () => {
    const { window } = running;
    await opened(window, DEMO_TITLE);
    const content = await editEmpty(window);
    const errors = content.locator("div.cm-lr-render-error");
    // Over Mermaid's edge limit of a flowchart.
    // 510 edges in 51 chains of 10 (a statement each would meet the statement bound first).
    const edges = Array.from({ length: 51 }, (_, line) =>
      Array.from({ length: 11 }, (_, at) => `n${String(line * 10 + at)}`).join(" --> "),
    );
    await window.keyboard.insertText(["```mermaid", "flowchart TD", ...edges, "```", ""].join("\n"));
    await window.keyboard.press("Escape");
    await expect(errors).toHaveText(
      /^Error\s*Edge limit exceeded\. \d+ edges found, but the limit is 500\.$/,
    );
    // Over the text size, checked before Mermaid sees the text.
    await window.keyboard.press("Enter");
    await window.keyboard.press("ControlOrMeta+a");
    await window.keyboard.insertText(
      ["```mermaid", "flowchart TD", `A["${"x".repeat(50_001)}"]`, "```", ""].join("\n"),
    );
    await window.keyboard.press("Escape");
    await expect(errors).toHaveText(/^Error\s*Diagram too large: 500\d\d characters, at most 50000\.$/);
    // Over the statements of any diagram type: lines, or parts of a line between `;`.
    await window.keyboard.press("Enter");
    await window.keyboard.press("ControlOrMeta+a");
    const states = Array.from({ length: 500 }, (_, at) => `s${String(at)} --> s${String(at + 1)}`);
    await window.keyboard.insertText(["```mermaid", "stateDiagram-v2", ...states, "```", ""].join("\n"));
    await window.keyboard.press("Escape");
    await expect(errors).toHaveText(/^Error\s*Diagram too large: 501 statements, at most 500\.$/);
    await window.keyboard.press("Enter");
    await window.keyboard.press("ControlOrMeta+a");
    const packed = Array.from({ length: 300 }, (_, line) =>
      Array.from(
        { length: 6 },
        (_, at) => `s${String((line * 6 + at) % 400)} --> s${String((line * 6 + at + 1) % 400)}`,
      ).join("; "),
    );
    await window.keyboard.insertText(["```mermaid", "stateDiagram-v2", ...packed, "```", ""].join("\n"));
    await window.keyboard.press("Escape");
    await expect(errors).toHaveText(/^Error\s*Diagram too large: 1801 statements, at most 500\.$/);
    await expect(content.locator("img.cm-lr-diagram")).toHaveCount(0);
  });

  test("large diagrams are drawn off the keystroke path: how long they hold the main thread", async () => {
    test.setTimeout(180_000);
    const { window } = running;
    await opened(window, DEMO_TITLE);
    const content = await editEmpty(window);
    await window.evaluate(() => {
      const record: { start: number; duration: number }[] = [];
      Reflect.set(window, "longTasks", record);
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          record.push({ start: entry.startTime, duration: entry.duration });
        }
      }).observe({ type: "longtask" });
    });
    // 200 nodes and 300 edges, the size of a large requirement diagram; the largest flowchart allowed with
    // one edge a statement (499 edges); the largest state diagram allowed (500 statements). Bounds: about 2.5
    // times the block measured on the Linux cloud container (1.3 s, 2.1 s, 1.8 s), as CI runners differ.
    const flowchart = (nodes: number, edges: number): string =>
      [
        "flowchart TD",
        ...Array.from(
          { length: edges },
          (_, at) => `n${String(at % nodes)} --> n${String((at * 7 + 1) % nodes)}`,
        ),
      ].join("\n");
    const stateDiagram = (lines: number): string =>
      [
        "stateDiagram-v2",
        ...Array.from(
          { length: lines - 1 },
          (_, at) => `s${String(at % 200)} --> s${String((at * 7 + 1) % 200)}`,
        ),
      ].join("\n");
    for (const [name, source, bound] of [
      ["flowchart, 200 nodes, 300 edges", flowchart(200, 300), 3500],
      ["flowchart, 300 nodes, 499 edges", flowchart(300, 499), 5500],
      ["state diagram, 200 states, 500 statements", stateDiagram(500), 5000],
    ] as const) {
      await window.evaluate(() => {
        (Reflect.get(window, "longTasks") as unknown[]).length = 0;
      });
      const start = Date.now();
      await window.keyboard.insertText(["```mermaid", source, "```", ""].join("\n"));
      await window.keyboard.press("Escape");
      const image = content.locator("img.cm-lr-diagram");
      await expect(image).toBeVisible({ timeout: 60_000 });
      await expect.poll(() => loaded(image), { timeout: 60_000 }).toBe(true);
      const drawn = Date.now() - start;
      const longest = Math.max(0, ...(await longTasks(window)).map((task) => task.duration));
      test.info().annotations.push({
        type: "measurement",
        description: `${name}: drawn after ${String(drawn)} ms, longest main-thread block ${String(Math.round(longest))} ms`,
      });
      expect(longest).toBeLessThan(bound);
      if (name.includes("499 edges")) {
        // Typing in it: the pause after a key grows with the last drawing (3 times it), so two keys 600 ms
        // apart see no drawing between them; leaving the diagram draws it at once.
        await image.click();
        await expect(content.locator(".cm-line", { hasText: "flowchart TD" })).toHaveCount(1);
        // The click puts the caret on the fence line; down onto a code line, so the keys change the source.
        await window.keyboard.press("ArrowDown");
        await window.keyboard.press("ArrowDown");
        await window.keyboard.press("End");
        const caretLine = await window.evaluate(() => {
          const node = getSelection()?.anchorNode;
          const element = node instanceof Element ? node : node?.parentElement;
          return element?.closest(".cm-line")?.textContent ?? "";
        });
        expect(caretLine).toMatch(/^n\d+ --> n\d+$/);
        const before = await window.evaluate(() => performance.now());
        await window.keyboard.type(" ");
        await window.waitForTimeout(600);
        await window.keyboard.type(" ");
        const after = await window.evaluate(() => performance.now());
        const between = (await longTasks(window)).filter(
          (task) => task.start + task.duration > before && task.start < after,
        );
        expect(between).toEqual([]);
        // Leaving the diagram draws it at once, not after three times the last drawing.
        const left = await window.evaluate(() => performance.now());
        await window.keyboard.press("Escape");
        await expect(content.locator(".cm-line", { hasText: "flowchart TD" })).toHaveCount(0);
        await expect
          .poll(async () =>
            (await longTasks(window)).some((task) => task.start > left && task.start < left + 1000),
          )
          .toBe(true);
      }
      // Back to an empty text for the next size.
      await window.keyboard.press("Enter");
      await window.keyboard.press("ControlOrMeta+a");
      await window.keyboard.press("Backspace");
    }
  });
});
