// element.readImage (SR-251): the bytes of an image file in the repository of an element, with its
// media type and size, named by the destination of a Markdown image relative to the element file.
// See model/read-image.ts.
import { defineCommand } from "../../catalog.js";
import { readImage } from "../../model/index.js";
import { sentence } from "../answer.js";

export default defineCommand({
  name: "element.readImage",
  answer: (output, input) =>
    sentence(`Read the image ${input.destination}: ${output.mediaType}, ${String(output.size)} bytes`),
  run: (ctx, input) => readImage(ctx.workspace, input),
});
