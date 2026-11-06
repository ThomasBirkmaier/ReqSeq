// Cross-access scenarios of element.addAttachment, in addition to the default one (cross-access.test.ts).
import type { FixtureOptions } from "@reqseq/testkit";
import { scenariosOf } from "../../scenario.js";

/** SR-004/one-repository with an image to attach, whose name ReqSeq makes portable (SR-097). */
const WITH_IMAGE: FixtureOptions = {
  fixture: "SR-004/one-repository",
  files: { "incoming/Wind Läyout (v2).png": "an image", "incoming/notes.txt": "no image" },
  git: true,
};

// `sourcePath` is a localPath, like `path` of workspace.init (scenarios/workspace/init.ts): the same file through every access.
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
  {
    name: "an image next to one copy of a UUID two files share, by repository and file (SR-088, #821)",
    fixture: {
      fixture: "SR-088/copied-file",
      files: { "system/incoming/layout.png": "an image" },
      git: true,
    },
    root: "system",
    input: {
      ref: "948a10f1-05c3-4212-bd19-00606ccf2661",
      repository: "system",
      file: "copies/N-00606ccf2661.md",
      sourcePath: "incoming/layout.png",
    },
    expect: "output",
  },
]);
