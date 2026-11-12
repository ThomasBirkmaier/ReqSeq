// @vitest-environment happy-dom
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import { markdownSupport } from "./markdown.js";
import type { PasteHost, PastedImage } from "./paste.js";
import {
  base64Of,
  handleDrop,
  handlePaste,
  imageName,
  imagePlaces,
  inCode,
  markdownOfHtml,
  pasteAsMarkdown,
  xhtmlOf,
} from "./paste.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

const viewOf = (doc: string, selection?: EditorSelection, readOnly = false): EditorView =>
  new EditorView({
    state: EditorState.create({
      doc,
      selection: selection ?? EditorSelection.single(doc.length),
      extensions: [
        markdownSupport({}),
        imagePlaces,
        EditorState.allowMultipleSelections.of(true),
        EditorState.readOnly.of(readOnly),
      ],
    }),
    parent: document.body,
  });

/** A clipboard or drop with these types and files. */
const transfer = (data: Record<string, string>, files: File[] = []): DataTransfer =>
  ({
    types: [...Object.keys(data), ...(files.length > 0 ? ["Files"] : [])],
    files,
    getData: (type: string) => data[type] ?? "",
  }) as unknown as DataTransfer;

const host = (markdown: (image: PastedImage) => string | undefined = (image) => `![x](F/${image.name})`) => {
  const attached: PastedImage[] = [];
  const echoed: string[] = [];
  const value: PasteHost = {
    attach: (image) => {
      attached.push(image);
      return Promise.resolve(markdown(image));
    },
    echo: (message) => {
      echoed.push(message);
    },
  };
  return { value, attached, echoed };
};

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

describe("paste as Markdown", () => {
  it("[SR-190/AK-wrfc] writes formatted text as Markdown with GitHub extensions, no HTML", () => {
    const view = viewOf("Vorher ");
    const { value, echoed } = host();
    const html =
      '<meta charset="utf-8"><h2>Titel</h2><p>Ein <b>fetter</b> <a href="https://example.org">Link</a> <img src="data:image/png;base64,AA" alt="Bild"></p><script>alert(1)</script>';
    expect(
      handlePaste(view, transfer({ "text/html": html, "text/plain": "Titel Ein fetter Link" }), value),
    ).toBe(true);
    expect(view.state.doc.toString()).toBe(
      "Vorher \n\n## Titel\n\nEin **fetter** [Link](https://example.org) Bild",
    );
    expect(echoed).toEqual([
      "1 pasted image was left out: only images on the network or from files are taken",
    ]);
    view.destroy();
  });

  it("pastes the plain text of unformatted HTML, of a code editor's copy, in code and when read-only", () => {
    const { value } = host();
    const plain = viewOf("x");
    expect(
      handlePaste(
        plain,
        transfer({ "text/html": "<div><span># a</span></div>", "text/plain": "# a" }),
        value,
      ),
    ).toBe(false);
    expect(
      handlePaste(
        plain,
        transfer({ "text/html": "<b>a</b>", "text/plain": "a", "vscode-editor-data": "{}" }),
        value,
      ),
    ).toBe(false);
    expect(handlePaste(plain, transfer({ "text/plain": "a" }), value)).toBe(false);
    const code = viewOf("```\nx\n```", EditorSelection.single(5));
    expect(inCode(code.state, 5)).toBe(true);
    expect(handlePaste(code, transfer({ "text/html": "<b>a</b>" }), value)).toBe(false);
    const locked = viewOf("x", undefined, true);
    expect(handlePaste(locked, transfer({ "text/html": "<b>a</b>" }), value)).toBe(false);
    for (const view of [plain, code, locked]) {
      view.destroy();
    }
  });

  it("[SR-190/AK-fzfw] makes each selected text a Markdown link to a pasted address", () => {
    const doc = "Siehe Quelle und Norm.";
    const view = viewOf(
      doc,
      EditorSelection.create([
        EditorSelection.range(6, 12),
        EditorSelection.range(17, 21),
        EditorSelection.cursor(0),
      ]),
    );
    expect(handlePaste(view, transfer({ "text/plain": " https://example.org/a(b) " }), host().value)).toBe(
      true,
    );
    expect(view.state.doc.toString()).toBe(
      "https://example.org/a(b)Siehe [Quelle](<https://example.org/a(b)>) und [Norm](<https://example.org/a(b)>).",
    );
    // Without a selection an address pastes as it is.
    const empty = viewOf("x");
    expect(handlePaste(empty, transfer({ "text/plain": "https://example.org" }), host().value)).toBe(false);
    view.destroy();
    empty.destroy();
  });

  it("[SR-190/AK-k05n] copies a pasted image file and writes its reference where it was pasted", async () => {
    const view = viewOf("a b", EditorSelection.single(1, 2));
    const { value, attached } = host();
    const file = new File([PNG], "", { type: "image/png" });
    expect(handlePaste(view, transfer({}, [file]), value)).toBe(true);
    // The selection stays until the copy answers, then the reference replaces it in one step.
    expect(view.state.doc.toString()).toBe("a b");
    view.dispatch({ changes: { from: 0, insert: "<" } });
    await settle();
    expect(attached).toEqual([{ content: base64Of(PNG), name: "image.png" }]);
    expect(view.state.doc.toString()).toBe("<a![x](F/image.png)b");
    expect(view.state.field(imagePlaces).size).toBe(0);
    view.destroy();
  });

  it("[SR-190/AK-k05n] copies dropped image files, one per line, where they were dropped", async () => {
    const view = viewOf("Text");
    const { value, attached } = host((image) =>
      image.name === "b.webp" ? undefined : `![a](F/${image.name})`,
    );
    const files = [
      new File([PNG], "a.PNG", { type: "image/png" }),
      new File([PNG], "b.webp", { type: "image/webp" }),
      new File([PNG], "c", { type: "image/jpeg" }),
    ];
    const event = { dataTransfer: transfer({}, files), clientX: 0, clientY: 0, preventDefault: vi.fn() };
    vi.spyOn(view, "posAtCoords").mockReturnValue(2);
    expect(handleDrop(view, event as unknown as DragEvent, value)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    await settle();
    expect(attached.map((image) => image.name)).toEqual(["a.PNG", "b.webp", "c.jpg"]);
    expect(view.state.doc.toString()).toBe("Te![a](F/a.PNG)\n![a](F/c.jpg)xt");
    view.destroy();
  });

  it("keeps the order of the images when their copies answer out of order, and skips one that is too large", async () => {
    const view = viewOf("[]", EditorSelection.single(1));
    const echoed: string[] = [];
    const slow: { resolve?: () => void } = {};
    const value: PasteHost = {
      attach: (image) =>
        image.name === "a.png"
          ? new Promise((resolve) => {
              slow.resolve = () => {
                resolve("A");
              };
            })
          : Promise.resolve("B"),
      echo: (message) => {
        echoed.push(message);
      },
    };
    const huge = new File([PNG], "huge.png", { type: "image/png" });
    Object.defineProperty(huge, "size", { value: 21 * 1024 * 1024 });
    const files = [
      new File([PNG], "a.png", { type: "image/png" }),
      huge,
      new File([PNG], "b.png", { type: "image/png" }),
    ];
    handlePaste(view, transfer({}, files), value);
    await settle();
    expect(view.state.doc.toString()).toBe("[]");
    slow.resolve?.();
    await settle();
    expect(view.state.doc.toString()).toBe("[A\nB]");
    expect(echoed).toEqual(["huge.png is larger than 20 MiB and was not copied"]);
    view.destroy();
  });

  it("escapes brackets in a link label and leaves a selection over paragraphs alone", () => {
    const view = viewOf("a]b\n\nc", EditorSelection.single(0, 3));
    expect(handlePaste(view, transfer({ "text/plain": "https://x.org" }), host().value)).toBe(true);
    expect(view.state.doc.toString()).toBe("[a\\]b](https://x.org)\n\nc");
    const over = viewOf("a\n\nb", EditorSelection.single(0, 4));
    expect(handlePaste(over, transfer({ "text/plain": "https://x.org" }), host().value)).toBe(false);
    view.destroy();
    over.destroy();
  });

  it("puts block content on lines of its own in the middle of a line", () => {
    const view = viewOf("Siehe Quelle", EditorSelection.single(6));
    handlePaste(view, transfer({ "text/html": "<h2>Wind</h2>" }), host().value);
    expect(view.state.doc.toString()).toBe("Siehe \n\n## Wind\n\nQuelle");
    view.destroy();
  });

  it("takes the HTML when a spreadsheet puts a picture of the table next to it", async () => {
    const view = viewOf("");
    const { value, attached } = host();
    const html = "<table><tr><th>A</th></tr><tr><td>1</td></tr></table>";
    expect(
      handlePaste(
        view,
        transfer({ "text/html": html }, [new File([PNG], "image.png", { type: "image/png" })]),
        value,
      ),
    ).toBe(true);
    expect(view.state.doc.toString()).toBe("| A |\n| - |\n| 1 |");
    expect(attached).toEqual([]);
    // HTML that is just the image stands for the file.
    expect(
      handlePaste(
        view,
        transfer({ "text/html": '<img src="x.png">' }, [new File([PNG], "image.png", { type: "image/png" })]),
        value,
      ),
    ).toBe(true);
    await settle();
    expect(attached).toHaveLength(1);
    view.destroy();
  });

  it("drops no file that is not an image, and leaves text drops to the editor", () => {
    const view = viewOf("x");
    const { value, echoed, attached } = host();
    const drop = (files: File[]) =>
      handleDrop(
        view,
        {
          dataTransfer: transfer({}, files),
          clientX: 0,
          clientY: 0,
          preventDefault: vi.fn(),
        } as unknown as DragEvent,
        value,
      );
    expect(
      drop([
        new File(["a"], "notes.txt", { type: "text/plain" }),
        new File([PNG], "a.png", { type: "image/png" }),
      ]),
    ).toBe(true);
    expect(echoed).toEqual(["Only image files can be dropped into the text"]);
    expect(drop([])).toBe(false);
    expect(attached).toEqual([]);
    const code = viewOf("```\nx\n```");
    vi.spyOn(code, "posAtCoords").mockReturnValue(5);
    expect(
      handleDrop(
        code,
        {
          dataTransfer: transfer({}, [new File([PNG], "a.png", { type: "image/png" })]),
          clientX: 0,
          clientY: 0,
          preventDefault: vi.fn(),
        } as unknown as DragEvent,
        value,
      ),
    ).toBe(true);
    expect(echoed.at(-1)).toBe("Images cannot be dropped into code");
    code.destroy();
    const locked = viewOf("x", undefined, true);
    expect(
      handleDrop(
        locked,
        {
          dataTransfer: transfer({}, [new File([PNG], "a.png", { type: "image/png" })]),
          preventDefault: vi.fn(),
        } as unknown as DragEvent,
        value,
      ),
    ).toBe(true);
    view.destroy();
    locked.destroy();
  });

  it("says when an image cannot be read, and writes nothing into an editor that is gone", async () => {
    const view = viewOf("x");
    const { value, echoed } = host();
    const broken = new File([PNG], "a.png", { type: "image/png" });
    vi.spyOn(broken, "arrayBuffer").mockRejectedValue(new Error("gone"));
    handlePaste(view, transfer({}, [broken]), value);
    await settle();
    expect(echoed).toEqual(["a.png could not be read: gone"]);
    expect(view.state.doc.toString()).toBe("x");
    const left = viewOf("y");
    handlePaste(left, transfer({}, [new File([PNG], "b.png", { type: "image/png" })]), value);
    left.dom.remove();
    await settle();
    expect(left.state.doc.toString()).toBe("y");
    expect(echoed.at(-1)).toBe(
      "The text was left before the image was copied; insert it yourself: ![x](F/b.png)",
    );
    view.destroy();
    left.destroy();
  });

  it("names images by their type and encodes large ones", () => {
    expect(imageName({ name: "Shot.JPEG", type: "image/jpeg" })).toBe("Shot.JPEG");
    expect(imageName({ name: "Shot", type: "IMAGE/SVG+XML" })).toBe("Shot.svg");
    expect(imageName({ name: "a.pdf", type: "application/pdf" })).toBeUndefined();
    const large = new Uint8Array(100_000).fill(65);
    expect(atob(base64Of(large))).toHaveLength(100_000);
  });

  it("reads the DOM as XHTML nodes, deep trees as text", () => {
    let html = "x";
    for (let i = 0; i < 300; i += 1) {
      html = `<span>${html}</span>`;
    }
    const body = new DOMParser().parseFromString(`<p title="t">a<!-- c --></p>${html}`, "text/html").body;
    const nodes = xhtmlOf(body.childNodes);
    expect(nodes[0]).toMatchObject({ name: "p", attributes: ["title", "t"], children: ["a"] });
    expect(markdownOfHtml("<p><i>i</i></p>")?.markdown).toBe("*i*");
  });

  it("is a plugin that handles paste and drop events", () => {
    const { value } = host();
    const view = new EditorView({
      state: EditorState.create({
        doc: "x",
        extensions: [markdownSupport({}), pasteAsMarkdown(() => value).extensions ?? []],
      }),
      parent: document.body,
    });
    const paste = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(paste, "clipboardData", { value: transfer({ "text/html": "<b>b</b>" }) });
    view.contentDOM.dispatchEvent(paste);
    expect(view.state.doc.toString()).toBe("**b**x");
    const plain = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(plain, "clipboardData", { value: null });
    view.contentDOM.dispatchEvent(plain);
    const drop = new Event("drop", { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(drop, "dataTransfer", { value: transfer({}, []) });
    view.contentDOM.dispatchEvent(drop);
    expect(view.state.doc.toString()).toBe("**b**x");
    view.destroy();
  });
});
