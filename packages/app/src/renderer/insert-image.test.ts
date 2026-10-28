import { describe, expect, it, vi } from "vitest";
import type { Answer, Call } from "./call.js";
import { INSERT_IMAGE_LABEL, imagePrompt } from "./insert-image.js";

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A prompt for element `u1` whose `element.addAttachment` answers `answer`. */
const setup = (answer: Answer<"element.addAttachment">) => {
  const calls: unknown[] = [];
  const call = ((name: string, input: unknown) => {
    calls.push([name, input]);
    return Promise.resolve(answer);
  }) as Call;
  const request = { insert: vi.fn<(markdown: string) => void>(), cancel: vi.fn() };
  const echo = vi.fn<(message: string) => void>();
  return { prompt: imagePrompt(call, "u1", request, echo), calls, request, echo };
};

const COPIED: Answer<"element.addAttachment"> = {
  ok: true,
  output: { file: "needs/N-1/wind.png", markdown: "![wind](N-1/wind.png)" },
};

describe("the prompt Insert image", () => {
  it("[SR-097/AK1] copies the typed file with element.addAttachment for the element and inserts its Markdown", async () => {
    const { prompt, calls, request, echo } = setup(COPIED);
    expect(prompt.label).toBe(INSERT_IMAGE_LABEL);
    expect(prompt.items).toEqual([]);
    prompt.text?.("  /tmp/wind.png ");
    await flush();
    expect(calls).toEqual([["element.addAttachment", { ref: "u1", sourcePath: "/tmp/wind.png" }]]);
    expect(request.insert).toHaveBeenCalledWith("![wind](N-1/wind.png)");
    expect(request.cancel).not.toHaveBeenCalled();
    expect(echo).not.toHaveBeenCalled();
  });

  it("says why core refused the file and inserts nothing", async () => {
    const { prompt, request, echo } = setup({
      ok: false,
      code: "input.invalid",
      message: "notes.txt is not an image",
    });
    prompt.text?.("notes.txt");
    await flush();
    expect(echo).toHaveBeenCalledWith("notes.txt is not an image");
    expect(request.insert).not.toHaveBeenCalled();
    expect(request.cancel).toHaveBeenCalledTimes(1);
  });

  it("cancels and says why when the call fails, so the slash menu's / is given back", async () => {
    const request = { insert: vi.fn<(markdown: string) => void>(), cancel: vi.fn() };
    const echo = vi.fn<(message: string) => void>();
    const failing = (() => Promise.reject(new Error("core stopped"))) as Call;
    imagePrompt(failing, "u1", request, echo).text?.("wind.png");
    await flush();
    expect(echo).toHaveBeenCalledWith("The image could not be copied: core stopped");
    expect(request.cancel).toHaveBeenCalledTimes(1);
    expect(request.insert).not.toHaveBeenCalled();
  });

  it("asks core nothing for an empty input, and Escape cancels", async () => {
    const { prompt, calls, request } = setup(COPIED);
    prompt.text?.("   ");
    await flush();
    expect(calls).toEqual([]);
    expect(request.cancel).toHaveBeenCalledTimes(1);
    prompt.cancel?.();
    expect(request.cancel).toHaveBeenCalledTimes(2);
  });
});
