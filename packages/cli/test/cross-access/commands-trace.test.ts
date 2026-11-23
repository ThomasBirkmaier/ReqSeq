// Cross-access test (SR-080) of the commands of one part, named by this file (harness.ts, `PARTS`).
import { describe, it } from "vitest";
import {
  MARK_OPENED,
  TEST_TIMEOUT,
  casesOf,
  expectSameAnswer,
  expectSameResult,
  partOfFile,
  useFixtures,
} from "./harness.js";

const { scenarios, answers } = casesOf(partOfFile(import.meta.url));
useFixtures(scenarios.map(({ scenario }) => scenario));

describe("cross-access: same result through core, CLI, API and MCP", { timeout: TEST_TIMEOUT }, () => {
  for (const { entry, scenario } of scenarios) {
    it(`${scenario.tag ?? "[SR-080/AK-bb1t]"}${entry.name === MARK_OPENED ? "" : " [SR-250/AK-vp6h]"} ${entry.name}, ${scenario.name}`, () =>
      expectSameResult(entry, scenario));
  }
});

describe("cross-access: the answer (SR-224 AK1)", { timeout: TEST_TIMEOUT }, () => {
  for (const entry of answers) {
    it(`[SR-224/AK-cw40] ${entry.name} gives the same answer through core, the CLI, the API and MCP`, () =>
      expectSameAnswer(entry));
  }
});
