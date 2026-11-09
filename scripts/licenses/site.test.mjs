import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  OWN_SOURCE,
  SITE_PACKAGES,
  builtSiteProblems,
  lockVersions,
  pnpmPackageReader,
  siteLicenses,
  sourcePackage,
} from "./site.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const siteLock = fs.readFileSync(
  path.join(here, "..", "..", "packages", "docs", "site", "pnpm-lock.yaml"),
  "utf8",
);

const roots = [];
afterEach(() => {
  for (const r of roots.splice(0)) {
    fs.rmSync(r, { recursive: true, force: true });
  }
});
const tempFolder = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "site-licenses-"));
  roots.push(root);
  return root;
};

/** A lockfile with these `name@version` packages. */
const lockOf = (...ids) =>
  `lockfileVersion: '9.0'\npackages:\n${ids.map((id) => `  '${id}':\n    resolution: {}\n`).join("")}`;
const installed = () => ({ license: "MIT", texts: ["MIT text"] });

describe("site licenses (SR-141, ADR-0015)", () => {
  it("reads the versions of each package of a lockfile", () => {
    expect(lockVersions(lockOf("@a/b@1.0.0", "c@2.0.0", "c@3.0.0"))).toEqual(
      new Map([
        ["@a/b", ["1.0.0"]],
        ["c", ["2.0.0", "3.0.0"]],
      ]),
    );
  });

  it("finds every shipped package once in the real site lockfile, MiniSearch among them", () => {
    const { entries, problems } = siteLicenses({ lockText: siteLock, readPackage: installed });
    expect(problems).toEqual([]);
    expect(entries.map((e) => e.name)).toEqual(SITE_PACKAGES.map((p) => p.name));
    expect(entries.find((e) => e.name === "minisearch")?.version).toBe("7.2.0");
  });

  it("reports a shipped package missing or twice in the lockfile, not installed, not allowed or without licence text", () => {
    const { entries, problems } = siteLicenses({
      lockText: lockOf("one@1.0.0", "two@1.0.0", "two@2.0.0", "absent@1.0.0", "bare@1.0.0", "gpl@1.0.0"),
      readPackage: (name) =>
        name === "absent"
          ? undefined
          : name === "bare"
            ? { license: "MIT", texts: [] }
            : name === "gpl"
              ? { license: "GPL-3.0-only", texts: ["GPL"] }
              : installed(),
      packages: ["one", "none", "two", "absent", "bare", "gpl"].map((name) => ({ name })),
    });
    expect(problems).toEqual([
      "shipped package none has 0 versions in the site lockfile",
      "shipped package two has 2 versions in the site lockfile",
      "shipped package absent@1.0.0 is not installed: run pnpm docs:install",
      "no licence text for bare@1.0.0 (shipped in the documentation site)",
      "license not allowed (ADR-0015): gpl@1.0.0: GPL-3.0-only (shipped in the documentation site)",
    ]);
    expect(entries).toEqual([{ name: "one", version: "1.0.0", license: "MIT", texts: ["MIT text"] }]);
  });

  it("reads a package of a pnpm install with its licence files", () => {
    const nm = tempFolder();
    const dir = path.join(nm, ".pnpm", "@p+a@1.0.0_peer", "node_modules", "@p", "a");
    fs.mkdirSync(path.join(dir, "LICENSE"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "@p/a", version: "1.0.0", license: "MIT" }),
    );
    fs.writeFileSync(path.join(dir, "LICENSE", "LICENSE"), "own");
    fs.writeFileSync(path.join(dir, "LICENSE", "LICENSE-other"), "other");
    fs.writeFileSync(path.join(dir, "NOTICE"), "notice");
    const read = pnpmPackageReader(nm);
    expect(read("@p/a", "1.0.0")).toEqual({ license: "MIT", texts: ["own", "other", "notice"] });
    expect(read("@p/a", "2.0.0")).toBeUndefined();
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@p/a", version: "1.0.1" }));
    expect(read("@p/a", "1.0.0")).toBeUndefined();
    expect(pnpmPackageReader(path.join(nm, "none"))("@p/a", "1.0.0")).toBeUndefined();
  });

  it("names the package of a source of a source map", () => {
    expect(sourcePackage("../../node_modules/.pnpm/astro@7.3.8_x/node_modules/astro/dist/a.js")).toBe(
      "astro",
    );
    expect(sourcePackage("../node_modules/.pnpm/@a+b@1/node_modules/@a/b/c.ts?astro&type=script")).toBe(
      "@a/b",
    );
    expect(sourcePackage("../../../../../astro:scripts/page.js")).toBe("astro");
    expect(sourcePackage("../../src/components/Search.astro?astro&type=script&index=0&lang.ts")).toBe(
      OWN_SOURCE,
    );
    expect(sourcePackage("../../../elsewhere/x.js")).toBeUndefined();
  });

  it("accepts a built site of the shipped files whose scripts come from listed packages only", () => {
    const site = tempFolder();
    const write = (file, text = "") => {
      fs.mkdirSync(path.dirname(path.join(site, file)), { recursive: true });
      fs.writeFileSync(path.join(site, file), text);
    };
    const map = (...sources) => JSON.stringify({ version: 3, sources });
    write("index.html");
    write("reference/commands/element-get/index.html");
    write("404.html");
    write("favicon.svg");
    write("_astro/page.a1.js");
    write("_astro/page.a1.js.map", map("../node_modules/astro/dist/p.js", "astro:scripts/page.js"));
    write("_astro/Toc.b2.js", 'import"./page.a1.js";');
    write("_astro/ec.c3.js");
    write("_astro/common.d4.css");
    write("_astro/app.e5.png");
    write("search-index.json", "{}");
    expect(builtSiteProblems(site, ["astro"])).toEqual([]);

    write("sitemap-index.xml");
    write("pagefind/pagefind.js");
    write("_astro/extra.f6.js", "var a=1;");
    write("_astro/ui.g7.js");
    write(
      "_astro/ui.g7.js.map",
      map("../node_modules/.pnpm/x@1/node_modules/@other/pkg/i.js", "../../../elsewhere/x.js"),
    );
    expect(builtSiteProblems(site, ["astro"])).toEqual([
      "file outside the shipped files of the site: pagefind/pagefind.js",
      "file outside the shipped files of the site: sitemap-index.xml",
      "script without its source map (build with REQSEQ_DOCS_OFFLINE=1): _astro/extra.f6.js",
      "_astro/ui.g7.js.map ships code of @other/pkg, which SITE_PACKAGES does not list",
      "_astro/ui.g7.js.map ships code of an unknown source ../../../elsewhere/x.js, which SITE_PACKAGES does not list",
    ]);
  });
});
