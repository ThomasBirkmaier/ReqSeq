// "Insert image" (SR-097): the prompt asks for the path of an image file, `element.addAttachment` copies it
// into the folder named like the element file, next to it, and the Markdown it returns, which embeds the
// copy relatively, goes into the text (`ImageRequest` of the editor). The text is saved as any input, by
// `element.update` (ADR-0002: core copies, names and checks the file; the app only passes the path). The
// path is typed text, relative to the workspace root or absolute (ADR-0009 `localPath`).
import type { Prompt } from "./actions.js";
import type { Call } from "./call.js";
import type { ImageRequest } from "./editor/reference-pick.js";

export const INSERT_IMAGE_LABEL = "Insert image";

/** The prompt "Insert image" for the element `ref`; `echo` says why core refused the file. */
export const imagePrompt = (
  call: Call,
  ref: string,
  request: ImageRequest,
  echo: (message: string) => void,
): Prompt => ({
  label: INSERT_IMAGE_LABEL,
  items: [],
  text: (text) => {
    const sourcePath = text.trim();
    if (sourcePath === "") {
      request.cancel();
      return;
    }
    // A call that fails (core gone) cancels too: the `/` the slash menu holds is given back, so autosave goes on.
    call("element.addAttachment", { ref, sourcePath }).then(
      (answer) => {
        if (answer.ok) {
          request.insert(answer.output.markdown);
        } else {
          echo(answer.message);
          request.cancel();
        }
      },
      (error: unknown) => {
        echo(`The image could not be copied: ${error instanceof Error ? error.message : String(error)}`);
        request.cancel();
      },
    );
  },
  cancel: request.cancel,
});
