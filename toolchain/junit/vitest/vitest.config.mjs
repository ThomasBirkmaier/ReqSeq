// The Vitest recipe of the guide (../README.md): configuration only. The JUnit reporter writes
// results.xml next to the default console output; `--outputFile.junit=<path>` moves the file.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["*.test.js"],
    reporters: ["default", "junit"],
    outputFile: { junit: "results.xml" },
  },
});
