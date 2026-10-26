// element.addAttachment (SR-097, ADR-0004): copies an image into the folder named like the element
// file, next to it, and returns the Markdown that embeds it relatively. The text is saved with
// element.update; from then on the image counts to the version (D-057). See model/attachment.ts.
import { defineCommand } from "../../catalog.js";
import { addAttachment } from "../../model/index.js";

export default defineCommand({
  name: "element.addAttachment",
  run: (ctx, input) => addAttachment(ctx.workspace, input),
});
