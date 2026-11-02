// Cross-access scenarios of element.addAttachment, in addition to the default one (cross-access.test.ts).
import type { FixtureOptions } from "@reqseq/testkit";
import { scenariosOf } from "../../scenario.js";

/** SR-004/one-repository with an image to attach, whose name ReqSeq makes portable (SR-097). */
const WITH_IMAGE: FixtureOptions = {
  fixture: "SR-004/one-repository",
  files: { "incoming/Wind Läyout (v2).png": "an image", "incoming/notes.txt": "no image" },
  git: true,
};

// `sourcePath` is a localPath, like `path` of workspace.init below: the same file through every access.
scenariosOf("element.addAttachment", [
  {
    name: "an image into the folder next to the element file, with its Markdown (SR-097 AK1, AK2)",
    fixture: WITH_IMAGE,
    input: { ref: "SR-e88fb3", sourcePath: "incoming/Wind Läyout (v2).png" },
    expect: "output",
  },
  {
    name: "a file that is no image",
    fixture: WITH_IMAGE,
    input: { ref: "SR-e88fb3", sourcePath: "incoming/notes.txt" },
    expect: "error",
  },
  {
    name: "an image that is not there",
    fixture: WITH_IMAGE,
    input: { ref: "SR-e88fb3", sourcePath: "incoming/gone.png" },
    expect: "error",
  },
]);
