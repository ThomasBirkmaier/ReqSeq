import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  SITE_BUNDLED,
  SITE_PACKAGES,
  builtSiteProblems,
  lockVersions,
  pnpmPackageReader,
  siteLicenses,
  sourcePackage,
  textReader,
} from "./site.mjs";
import { licenseAllowed } from "./policy.mjs";

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

  it("finds in the real site lockfile every shipped package once and every pinned host of bundled code, and refuses the GPL-3.0 and Unicode-3.0 crates of Pagefind's WebAssembly (#1220)", () => {
    const { entries, problems } = siteLicenses({
      lockText: siteLock,
      readPackage: installed,
      readText: textReader(path.join(here, "site-texts")),
    });
    expect(problems).toEqual([
      "license not allowed (ADR-0015): pagefind_microjson@0.1.4: GPL-3.0-only (shipped in the documentation site)",
      "license not allowed (ADR-0015): unicode-ident@1.0.24: (MIT OR Apache-2.0) AND Unicode-3.0 (shipped in the documentation site)",
    ]);
    expect(entries).toHaveLength(SITE_PACKAGES.length + SITE_BUNDLED.length);
  });

  it("reports a shipped package missing or twice in the lockfile, not installed, without licence text, or a stale host", () => {
    const { entries, problems } = siteLicenses({
      lockText: lockOf("one@1.0.0", "two@1.0.0", "two@2.0.0", "absent@1.0.0", "bare@1.0.0", "host@2.0.0"),
      readPackage: (name) =>
        name === "absent" ? undefined : name === "bare" ? { license: "MIT", texts: [] } : installed(),
      readText: (file) => (file === "inner@1.0.0.txt" ? "text" : undefined),
      packages: [
        { name: "one" },
        { name: "none" },
        { name: "two" },
        { name: "absent" },
        { name: "bare" },
        { name: "lent", textOf: "one" },
      ],
      bundled: [
        { name: "inner", version: "1.0.0", license: "MIT", inside: ["host@1.0.0"] },
        { name: "gpl", version: "1.0.0", license: "GPL-3.0-only", inside: ["host@2.0.0"] },
      ],
    });
    expect(problems).toEqual([
      "shipped package none has 0 versions in the site lockfile",
      "shipped package two has 2 versions in the site lockfile",
      "shipped package absent@1.0.0 is not installed: run pnpm docs:install",
      "shipped package lent has 0 versions in the site lockfile",
      "bundled inner@1.0.0 was read for host@1.0.0, which the site lockfile no longer has: read the bundled code again",
      "no licence text for bare@1.0.0 (shipped in the documentation site)",
      "license not allowed (ADR-0015): gpl@1.0.0: GPL-3.0-only (shipped in the documentation site)",
    ]);
    expect(entries.map((e) => `${e.name}@${e.version}`)).toEqual([
      "one@1.0.0",
      "bare@1.0.0",
      "inner@1.0.0",
      "gpl@1.0.0",
    ]);
  });

  it("takes the licence text of another shipped package for one that ships none", () => {
    const { entries, problems } = siteLicenses({
      lockText: lockOf("pagefind@1.5.2", "@pagefind/default-ui@1.5.2", "x@1.0.0"),
      readPackage: (name) => ({ license: "MIT", texts: name === "pagefind" ? ["Pagefind MIT"] : [] }),
      readText: () => undefined,
      packages: [
        { name: "pagefind" },
        { name: "@pagefind/default-ui", textOf: "pagefind" },
        { name: "x", textOf: "gone" },
      ],
      bundled: [],
    });
    expect(entries[1]).toEqual({
      name: "@pagefind/default-ui",
      version: "1.5.2",
      license: "MIT",
      texts: ["Pagefind MIT"],
    });
    expect(problems).toEqual(["no licence text for x@1.0.0 (shipped in the documentation site)"]);
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

  it("has a licence text for every allowed bundled component, and no text that no entry names", () => {
    const read = textReader(path.join(here, "site-texts"));
    for (const entry of SITE_BUNDLED.filter((e) => licenseAllowed(e.license))) {
      expect(read(`${entry.name}@${entry.version}.txt`), entry.name).toBeDefined();
    }
    const named = new Set(SITE_BUNDLED.map((e) => `${e.name}@${e.version}.txt`));
    expect(fs.readdirSync(path.join(here, "site-texts")).filter((f) => !named.has(f))).toEqual([]);
  });

  it("names the package of a source of a source map", () => {
    expect(sourcePackage("../../node_modules/.pnpm/astro@7.3.8_x/node_modules/astro/dist/a.js")).toBe(
      "astro",
    );
    expect(sourcePackage("../node_modules/.pnpm/@a+b@1/node_modules/@a/b/c.ts?astro&type=script")).toBe(
      "@a/b",
    );
    expect(sourcePackage("../../../../../astro:scripts/page.js")).toBe("astro");
    expect(sourcePackage("../src/own.js")).toBeUndefined();
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
    write("pagefind/wasm.en.pagefind");
    write("pagefind/index/en_1.pf_index");
    expect(builtSiteProblems(site, ["astro"])).toEqual([]);

    write("sitemap-index.xml");
    write("_astro/extra.f6.js", "var a=1;");
    write("_astro/ui.g7.js");
    write(
      "_astro/ui.g7.js.map",
      map("../node_modules/.pnpm/x@1/node_modules/@other/pkg/i.js", "../src/own.js"),
    );
    expect(builtSiteProblems(site, ["astro"])).toEqual([
      "file outside the shipped files of the site: sitemap-index.xml",
      "script without its source map (build with REQSEQ_DOCS_OFFLINE=1): _astro/extra.f6.js",
      "_astro/ui.g7.js.map ships code of @other/pkg, which SITE_PACKAGES does not list",
      "_astro/ui.g7.js.map ships code of an unknown source ../src/own.js, which SITE_PACKAGES does not list",
    ]);
  });
});
