// Cross-access scenarios of element.readImage (SR-251), in addition to the default one (harness.ts).
import type { FixtureOptions } from "@reqseq/testkit";
import { scenariosOf } from "../../scenario.js";

/** A 1x1 PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/** SR-004/one-repository with images next to the element file of SR-e88fb3, one outside the repository. */
const WITH_IMAGES: FixtureOptions = {
  fixture: "SR-004/one-repository",
  files: {
    "requirements/SR-6328cee88fb3/Wind map.png": PNG,
    "requirements/SR-6328cee88fb3/notes.png": "no image",
  },
  git: true,
};

/** WITH_IMAGES with another repository of the workspace inside its folder (SR-251 AK5). */
const WITH_INNER: FixtureOptions = {
  ...WITH_IMAGES,
  files: {
    ...WITH_IMAGES.files,
    "inner/a.png": PNG,
    "reqseq-workspace.yaml": [
      "reqseq-workspace: 1",
      "name: Weather station",
      "repositories:",
      '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }',
      '  - { name: inner, url: "git@git.example.com:ws/inner.git", path: inner }',
      "metamodel: { repository: system, path: metamodel }",
      "",
    ].join("\n"),
  },
};

// `destination` is no local path (SR-142): the same text through every access, read relative to the element file.
scenariosOf("element.readImage", [
  {
    name: "an image next to the element file, by a percent-encoded destination with a query",
    tag: "[SR-251/AK-bbgy]",
    fixture: WITH_IMAGES,
    input: { ref: "SR-e88fb3", destination: "SR-6328cee88fb3/Wind%20map.png?raw=1" },
    expect: "output",
  },
  {
    name: "a destination with a scheme",
    tag: "[SR-251/AK-vj1m]",
    fixture: WITH_IMAGES,
    input: { ref: "SR-e88fb3", destination: "https://example.com/a.png" },
    expect: "error",
  },
  {
    name: "a destination out of the repository",
    tag: "[SR-251/AK-vj1m]",
    fixture: WITH_IMAGES,
    input: { ref: "SR-e88fb3", destination: "../../outside.png" },
    expect: "error",
  },
  {
    name: "a destination into another repository of the workspace inside this one",
    tag: "[SR-251/AK-vj1m]",
    fixture: WITH_INNER,
    input: { ref: "SR-e88fb3", destination: "../inner/a.png" },
    expect: "error",
  },
  {
    name: "an image that is not there",
    fixture: WITH_IMAGES,
    input: { ref: "SR-e88fb3", destination: "SR-6328cee88fb3/gone.png" },
    expect: "error",
  },
  {
    name: "a file that is no image",
    fixture: WITH_IMAGES,
    input: { ref: "SR-e88fb3", destination: "SR-6328cee88fb3/notes.png" },
    expect: "error",
  },
]);
