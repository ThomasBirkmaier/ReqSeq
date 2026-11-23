// Cross-access scenarios of workspace.markOpened, in addition to the default one (harness.ts).
// The list of recent workspaces lies in the OS cache folder of the test process, outside the copy, so
// each scenario prepares it before every access and checks it after (`after`); each access gets a copy of
// its own, whose root the list then holds first (SR-250).
import fs from "node:fs/promises";
import path from "node:path";
import type { RecentWorkspace } from "@reqseq/core";
import {
  RECENT_WORKSPACES_FILE,
  readRecentWorkspaces,
  recentWorkspacesFolder,
  rememberWorkspace,
} from "@reqseq/core";
import { expect } from "vitest";
import type { Copy } from "../../scenario.js";
import { scenariosOf } from "../../scenario.js";

const at = (minute: number): Date => new Date(Date.UTC(2026, 9, 27, 10, minute));

const listFile = (): string => path.join(recentWorkspacesFolder(), RECENT_WORKSPACES_FILE);

/** A fresh list with `roots`, the first one opened last. */
const listOf = async (roots: readonly string[]): Promise<void> => {
  await fs.rm(listFile(), { force: true });
  for (const [index, root] of [...roots].reverse().entries()) {
    await rememberWorkspace(root, { now: at(index) });
  }
};

/** Folders next to the copy (none of them a workspace), as entries of the list. */
const others = ({ top }: Copy, count: number): string[] =>
  Array.from({ length: count }, (_, n) =>
    path.join(path.dirname(top), `other-${String(n + 1).padStart(2, "0")}`),
  );

/** Another spelling of the root of the copy: a link next to it (a junction on Windows). */
const linkTo = ({ top }: Copy): string => path.join(path.dirname(top), "link");

const roots = (list: readonly RecentWorkspace[]): string[] => list.map((entry) => entry.root);

scenariosOf("workspace.markOpened", [
  {
    name: "puts the workspace first, once although the list holds it under another spelling",
    tag: "[SR-250/AK-dky0]",
    input: {},
    expect: "output",
    prepare: async (copy) => {
      await fs.rm(linkTo(copy), { force: true });
      await fs.symlink(copy.root, linkTo(copy), "junction");
      await listOf([...others(copy, 1), linkTo(copy)]);
    },
    after: async (copy, access) => {
      const list = await readRecentWorkspaces();
      expect([access, roots(list)]).toEqual([access, [copy.root, ...others(copy, 1)]]);
      expect([access, Date.parse(list[0]?.opened ?? "") > at(1).getTime()]).toEqual([access, true]);
    },
  },
  {
    name: "with 20 entries, the one marked longest ago goes",
    tag: "[SR-250/AK-yz3j]",
    input: {},
    expect: "output",
    prepare: async (copy) => {
      await listOf(others(copy, 20));
    },
    after: async (copy, access) => {
      const list = await readRecentWorkspaces();
      expect([access, roots(list)]).toEqual([access, [copy.root, ...others(copy, 19)]]);
    },
  },
  {
    name: "creates the list with this one entry when there is none",
    tag: "[SR-250/AK-vr1n]",
    input: {},
    expect: "output",
    prepare: async () => {
      await fs.rm(listFile(), { force: true });
    },
    after: async (copy, access) => {
      expect([access, roots(await readRecentWorkspaces())]).toEqual([access, [copy.root]]);
    },
  },
  {
    name: "refuses a list it cannot read and leaves it as it is",
    tag: "[SR-250/AK-vr1n]",
    input: {},
    expect: "error",
    prepare: async () => {
      await fs.mkdir(path.dirname(listFile()), { recursive: true });
      await fs.writeFile(listFile(), "not a list\n");
    },
    after: async (_copy, access) => {
      expect([access, await fs.readFile(listFile(), "utf8")]).toEqual([access, "not a list\n"]);
    },
  },
]);
