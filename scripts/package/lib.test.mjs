import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  hardLinkEntries,
  isBuildLeftover,
  noticesText,
  packageFolders,
  removeBuildLeftovers,
  renderLauncher,
  stagedManifest,
  tagReleasesVersion,
} from "./lib.mjs";

const folders = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((f) => fs.rm(f, { recursive: true, force: true })));
});

const tempFolder = async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "stage-test-"));
  folders.push(folder);
  return folder;
};

/** Writes a package folder with its package.json and other files. */
const writePackage = async (folder, manifest, files = {}) => {
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, "package.json"), JSON.stringify(manifest));
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(folder, name), content);
  }
};

describe("stagedManifest", () => {
  it("pins the workspace packages to the version and drops development fields", () => {
    const manifest = {
      name: "@w/cli",
      version: "0.0.0",
      scripts: { build: "tsc -b" },
      dependencies: { "@w/core": "workspace:*", yaml: "2.9.1" },
      peerDependencies: { "@w/api": "workspace:^" },
      devDependencies: { "@w/testkit": "workspace:*" },
    };
    expect(
      stagedManifest(manifest, { version: "0.3.0", scope: "@w/", extra: { bundleDependencies: true } }),
    ).toEqual({
      name: "@w/cli",
      version: "0.3.0",
      dependencies: { "@w/core": "0.3.0", yaml: "2.9.1" },
      peerDependencies: { "@w/api": "0.3.0" },
      bundleDependencies: true,
    });
  });

  it("refuses a local spec that npm cannot install", () => {
    const manifest = { name: "@w/app", optionalDependencies: { other: "link:../other" } };
    expect(() => stagedManifest(manifest, { version: "1.0.0", scope: "@w/" })).toThrow(
      '@w/app: optionalDependencies.other is still "link:../other"',
    );
  });
});

describe("tagReleasesVersion", () => {
  it.each([
    ["v0.3", "0.3.0", true],
    ["v0.3.0", "0.3.0", true],
    ["v1.2.3", "1.2.3", true],
    ["v1.2", "1.2.3", false],
    ["v0.4", "0.3.0", false],
    ["v0.0.0-rc.324", "0.0.0", false],
    ["0.3.0", "0.3.0", false],
    ["v0.3", "0.3.0-beta", false],
  ])("%s releases %s: %s", (tag, version, expected) => {
    expect(tagReleasesVersion(tag, version)).toBe(expected);
  });
});

describe("renderLauncher", () => {
  it("fills in the product name and keeps LF", () => {
    expect(renderLauncher("run @PRODUCT@\r\nand @PRODUCT@.exe\n", { productName: "Tool" })).toBe(
      "run Tool\nand Tool.exe\n",
    );
  });

  it("writes CRLF for Windows", () => {
    expect(renderLauncher("a @PRODUCT@\nb\n", { productName: "Tool" }, { crlf: true })).toBe(
      "a Tool\r\nb\r\n",
    );
  });
});

describe("packageFolders and noticesText", () => {
  it("lists flat, scoped and nested packages and skips hidden folders, files and a missing folder", async () => {
    const nm = path.join(await tempFolder(), "node_modules");
    await writePackage(path.join(nm, "a"), { name: "a", version: "1.0.0" });
    await writePackage(path.join(nm, "@s", "b"), { name: "@s/b", version: "2.0.0" });
    await writePackage(path.join(nm, "a", "node_modules", "c"), { name: "c", version: "3.0.0" });
    await fs.mkdir(path.join(nm, ".bin"));
    await fs.writeFile(path.join(nm, ".modules.yaml"), "");
    await fs.writeFile(path.join(nm, "@s", "README"), "");
    const found = (await packageFolders(nm)).map((p) => path.relative(nm, p)).sort();
    expect(found).toEqual(["@s/b", "a", path.join("a", "node_modules", "c")].sort());
    expect(await packageFolders(path.join(nm, "missing"))).toEqual([]);
  });

  it("refuses a symbolic link, flat or scoped", async () => {
    const nm = path.join(await tempFolder(), "node_modules");
    await writePackage(path.join(nm, "a"), { name: "a", version: "1.0.0" });
    await fs.mkdir(path.join(nm, "@s"));
    await fs.symlink(path.join(nm, "a"), path.join(nm, "@s", "b"), "junction");
    await expect(packageFolders(nm)).rejects.toThrow(
      `symbolic link in a staged node_modules: ${path.join(nm, "@s", "b")}`,
    );
    await fs.rm(path.join(nm, "@s"), { recursive: true });
    await fs.symlink(path.join(nm, "a"), path.join(nm, "c"), "junction");
    await expect(packageFolders(nm)).rejects.toThrow(
      `symbolic link in a staged node_modules: ${path.join(nm, "c")}`,
    );
  });

  it("names every third-party package once with its licence texts, sorted, without the workspace's own", async () => {
    const one = path.join(await tempFolder(), "node_modules");
    const two = path.join(await tempFolder(), "node_modules");
    await writePackage(
      path.join(one, "@dagrejs", "dagre"),
      { name: "@dagrejs/dagre", version: "3.1.1", license: "MIT" },
      {
        LICENSE: "MIT text of dagre\n",
        "index.js": "",
      },
    );
    await writePackage(path.join(one, "@dagrejs", "graphlib"), {
      name: "@dagrejs/graphlib",
      version: "4.0.5",
      license: "MIT",
    });
    await writePackage(path.join(one, "@w", "core"), { name: "@w/core", version: "0.3.0" });
    await writePackage(path.join(two, "@dagrejs", "graphlib"), {
      name: "@dagrejs/graphlib",
      version: "4.0.5",
      license: "MIT",
    });
    await writePackage(
      path.join(two, "zz"),
      { name: "zz", version: "1.0.0" },
      { "NOTICE.md": "notice\n", COPYING: "copying\n" },
    );
    await writePackage(
      path.join(two, "old"),
      { name: "old", version: "0.1.0", license: { type: "BSD-3-Clause", url: "https://example.org" } },
      { LICENSE: "BSD text\n" },
    );
    const text = await noticesText({
      nodeModules: [one, two],
      scope: "@w/",
      required: ["@dagrejs/dagre", "@dagrejs/graphlib"],
      title: "Third-party software",
    });
    const separator = `\n\n${"-".repeat(72)}\n\n`;
    expect(text).toBe(
      [
        "Third-party software\n\n@dagrejs/dagre 3.1.1\nLicense: MIT\n\nMIT text of dagre",
        "@dagrejs/graphlib 4.0.5\nLicense: MIT\n\n(the package has no licence file)",
        "old 0.1.0\nLicense: BSD-3-Clause\n\nBSD text",
        "zz 1.0.0\nLicense: see below\n\ncopying\nnotice",
      ].join(separator) + "\n",
    );
  });

  it("fails when a required package is missing", async () => {
    const nm = path.join(await tempFolder(), "node_modules");
    await writePackage(path.join(nm, "a"), { name: "a", version: "1.0.0", license: "MIT" });
    await expect(
      noticesText({ nodeModules: [nm], scope: "@w/", required: ["@dagrejs/dagre", "a"], title: "T" }),
    ).rejects.toThrow("third-party notices: @dagrejs/dagre not found");
  });
});

describe("build leftovers and hard links", () => {
  it("removes source maps, type declarations and build info and keeps the rest", async () => {
    const root = await tempFolder();
    const files = ["a.js", "a.js.map", "a.d.ts", "b.d.mts", "c.d.cts", "test.tsbuildinfo", "map.js", "a.ts"];
    await fs.mkdir(path.join(root, "dist", "deep"), { recursive: true });
    for (const file of files) {
      await fs.writeFile(path.join(root, "dist", "deep", file), "");
    }
    expect(await removeBuildLeftovers(root)).toBe(5);
    expect((await fs.readdir(path.join(root, "dist", "deep"))).sort()).toEqual(["a.js", "a.ts", "map.js"]);
    expect(isBuildLeftover("x.d.ts")).toBe(true);
  });

  it("finds the hard-link entries of a tar listing", () => {
    const listing = [
      "-rw-r--r-- 0/0 1 1985-10-26 08:15 package/a.js",
      "hrw-r--r-- 0/0 0 1985-10-26 08:15 package/b.js link to package/a.js",
      "drwxr-xr-x 0/0 0 1985-10-26 08:15 package/dir/",
      "",
    ].join("\r\n");
    expect(hardLinkEntries(listing)).toEqual([
      "hrw-r--r-- 0/0 0 1985-10-26 08:15 package/b.js link to package/a.js",
    ]);
  });
});
