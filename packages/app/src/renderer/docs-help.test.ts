import { describe, expect, it, vi } from "vitest";
import type { Action, Prompt } from "./actions.js";
import { docsEcho, docsTopic, withHelp } from "./docs-help.js";

const action = (id: string, title: string, covers?: readonly string[]): Action => ({
  id,
  title,
  ...(covers === undefined ? {} : { covers }),
  available: () => true,
  run: () => undefined,
});

const ACTIONS = [
  action("go-to", "Go to element or buffer", ["element.get"]),
  action("list-all", "List all elements"),
  action("close-all", "Close all buffers"),
];
const CATALOG = [{ name: "element.list", title: "List all elements" }];

describe("docsTopic", () => {
  it("is the catalog command of an entry, by its ID, the action's `covers` or the same title, else the action", () => {
    expect(docsTopic("command:trace.chain", CATALOG, ACTIONS)).toBe("trace.chain");
    expect(docsTopic("go-to", CATALOG, ACTIONS)).toBe("element.get");
    expect(docsTopic("list-all", CATALOG, ACTIONS)).toBe("element.list");
    expect(docsTopic("close-all", CATALOG, ACTIONS)).toBe("close-all");
    // An action that runs one of several commands by the shown display has its own row (SR-210 AK5).
    expect(docsTopic("copy-mermaid", CATALOG, ACTIONS)).toBe("copy-mermaid");
    // An entry that is no action (a buffer of "Go to") is sent as it is; main refuses what it does not know.
    expect(docsTopic("buffer:1", CATALOG, ACTIONS)).toBe("buffer:1");
  });

  it("reads the app's own actions by default", () => {
    expect(docsTopic("open-documentation", [])).toBe("open-documentation");
  });
});

describe("withHelp", () => {
  const prompt: Prompt = { label: "Command", items: [] };

  it("adds F1 only where the app can open the documentation", () => {
    expect(withHelp(prompt, {}, CATALOG)).toBe(prompt);
    const docs = vi.fn();
    const helped = withHelp(prompt, { docs }, CATALOG);
    helped.help?.(undefined);
    expect(docs).toHaveBeenLastCalledWith(undefined);
    helped.help?.({ id: "command:element.list", name: "List all elements", run: () => undefined });
    expect(docs).toHaveBeenLastCalledWith("element.list");
  });
});

describe("docsEcho", () => {
  it("says that the browser shows it, or why not", () => {
    expect(docsEcho({ ok: true })).toBe("Opened the documentation in the browser");
    expect(docsEcho({ ok: false, message: "No documentation in /x" })).toBe("No documentation in /x");
  });
});
