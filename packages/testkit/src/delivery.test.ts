import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DeliveryNames, DeliverySystem } from "./delivery.js";
import {
  WINDOWS_TAR,
  asarEntries,
  cliTarballName,
  connectProbe,
  deliveryArtifactName,
  deliveryLayout,
  inspectDelivery,
  installDelivery,
  isBuildLeftover,
  offlineProblems,
  readAsarHeader,
  readFuses,
  unpackCommand,
} from "./delivery.js";

const NAMES: DeliveryNames = {
  productName: "Tool",
  appId: "org.example.tool",
  launcher: "tool",
  packageScope: "@t/",
  cliTarball: "tool-cli-${version}.tgz",
  artifact: "${productName}-${version}-${os}-${arch}.${ext}",
};
const NOTICES = ["@dagrejs/dagre", "@dagrejs/graphlib"];
const SENTINEL = "dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX";
/** NTFS has no execute bits: on Windows the inspector does not check them, so no test expects that finding. */
const EXEC_BITS = process.platform !== "win32";

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((f) => fs.rm(f, { recursive: true, force: true })));
});

const tempFolder = async (): Promise<string> => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "delivery-test-"));
  folders.push(folder);
  return folder;
};

/** An asar archive with `header` and no file contents. */
const asar = (header: unknown): Buffer => {
  const json = Buffer.from(JSON.stringify(header));
  const padded = Math.ceil(json.length / 4) * 4;
  const out = Buffer.alloc(16 + padded);
  out.writeUInt32LE(4, 0);
  out.writeUInt32LE(8 + padded, 4);
  out.writeUInt32LE(4 + padded, 8);
  out.writeUInt32LE(json.length, 12);
  json.copy(out, 16);
  return out;
};

/** A binary with a fuse wire of `wire` ("1", "0", "r" per fuse). */
const binary = (wire: string): Buffer =>
  Buffer.concat([
    Buffer.from("ELF..."),
    Buffer.from(SENTINEL),
    Buffer.from([1, wire.length]),
    Buffer.from(wire),
  ]);

const GOOD_ASAR = {
  files: {
    "package.json": { size: 1, offset: "0" },
    out: { files: { main: { files: { "index.js": { size: 1, offset: "0" } } } } },
    node_modules: {
      files: {
        "@t": {
          files: {
            core: { files: { dist: { files: { "code-fingerprint.json": { size: 1, offset: "0" } } } } },
          },
        },
      },
    },
  },
};

/** Writes an installed delivery of `system` at `root` that passes the inspection. */
const writeDelivery = async (root: string, system: DeliverySystem): Promise<void> => {
  const layout = deliveryLayout(NAMES, system);
  const write = async (file: string, content: string | Buffer, mode = 0o644): Promise<void> => {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), content, { mode });
  };
  const cli = path.join(layout.resources, "cli");
  await write(layout.app, layout.app === layout.fuseBinary ? binary("100001") : "app", 0o755);
  await write(layout.fuseBinary, binary("100001"), 0o755);
  await write(layout.launcher, "#!/bin/sh\n", 0o755);
  for (const file of layout.executables) {
    await fs.access(path.join(root, file)).catch(() => write(file, "", 0o755));
  }
  await write(path.join(cli, "dist", "bin.js"), "");
  await write(path.join(cli, "node_modules", "@t", "api", "package.json"), "{}");
  await write(path.join(cli, "node_modules", "@t", "mcp", "package.json"), "{}");
  await write(path.join(cli, "node_modules", "@t", "core", "dist", "code-fingerprint.json"), "{}");
  await write(path.join(cli, "node_modules", "@t", "core", "dist", "model", "read-worker.js"), "");
  await write(path.join(layout.resources, "docs", "junit", "README.md"), "");
  await write(
    path.join(layout.resources, "THIRD_PARTY_NOTICES.txt"),
    "@dagrejs/dagre 3.1.1\n\n@dagrejs/graphlib 4.0.5\n",
  );
  await write(path.join(layout.resources, "app.asar"), asar(GOOD_ASAR));
};

describe("names", () => {
  it("names the artifact of every system and the CLI tarball", () => {
    expect(deliveryArtifactName(NAMES, "mac", "0.3.0")).toBe("Tool-0.3.0-mac-arm64.zip");
    expect(deliveryArtifactName(NAMES, "linux", "0.3.0")).toBe("Tool-0.3.0-linux-x64.tar.gz");
    expect(deliveryArtifactName(NAMES, "win", "0.3.0")).toBe("Tool-0.3.0-win-x64.zip");
    expect(cliTarballName(NAMES, "0.3.0")).toBe("tool-cli-0.3.0.tgz");
  });

  it("lays out the app, its fuse binary, the launcher and the resources per system", () => {
    expect(deliveryLayout(NAMES, "mac")).toEqual({
      app: path.join("Tool.app", "Contents", "MacOS", "Tool"),
      fuseBinary: path.join(
        "Tool.app",
        "Contents",
        "Frameworks",
        "Electron Framework.framework",
        "Electron Framework",
      ),
      launcher: path.join("Tool.app", "Contents", "Resources", "bin", "tool"),
      resources: path.join("Tool.app", "Contents", "Resources"),
      executables: [
        path.join("Tool.app", "Contents", "MacOS", "Tool"),
        path.join("Tool.app", "Contents", "Resources", "bin", "tool"),
      ],
    });
    expect(deliveryLayout(NAMES, "linux")).toEqual({
      app: "Tool",
      fuseBinary: "Tool",
      launcher: path.join("bin", "tool"),
      resources: "resources",
      executables: ["Tool", path.join("bin", "tool"), "chrome-sandbox"],
    });
    expect(deliveryLayout(NAMES, "win")).toEqual({
      app: "Tool.exe",
      fuseBinary: "Tool.exe",
      launcher: path.join("bin", "tool.cmd"),
      resources: "resources",
      executables: [],
    });
  });
});

describe("unpackCommand", () => {
  it.each([
    ["a.tar.gz", "linux", "tar", ["-xzf", "a.tar.gz", "-C", "d"]],
    ["a.tgz", "darwin", "tar", ["-xzf", "a.tgz", "-C", "d"]],
    ["a.zip", "darwin", "ditto", ["-x", "-k", "a.zip", "d"]],
    ["a.zip", "win32", WINDOWS_TAR, ["-xf", "a.zip", "-C", "d"]],
    ["a.tar.gz", "win32", WINDOWS_TAR, ["-xf", "a.tar.gz", "-C", "d"]],
    ["a.zip", "linux", "unzip", ["-q", "-o", "a.zip", "-d", "d"]],
  ] as const)("%s on %s: %s", (artifact, host, command, args) => {
    expect(unpackCommand(artifact, "d", host)).toEqual({ command, args });
  });
});

describe("asar", () => {
  it("lists the entries of a header and reads the header of an archive", async () => {
    const file = path.join(await tempFolder(), "app.asar");
    await fs.writeFile(file, asar(GOOD_ASAR));
    expect(asarEntries(await readAsarHeader(file))).toEqual([
      "/package.json",
      "/out",
      "/out/main",
      "/out/main/index.js",
      "/node_modules",
      "/node_modules/@t",
      "/node_modules/@t/core",
      "/node_modules/@t/core/dist",
      "/node_modules/@t/core/dist/code-fingerprint.json",
    ]);
    expect(asarEntries(null)).toEqual([]);
  });
});

describe("readFuses", () => {
  it("reads on, off and removed fuses, and only as many as the wire has", () => {
    expect(readFuses(binary("10r"))).toEqual({
      runAsNode: "on",
      enableCookieEncryption: "off",
      enableNodeOptionsEnvironmentVariable: "removed",
    });
  });

  it("gives undefined without a wire and nothing for a wire cut off after the sentinel", () => {
    expect(readFuses(Buffer.from("no fuses here"))).toBeUndefined();
    expect(readFuses(Buffer.from(SENTINEL))).toEqual({});
    expect(readFuses(Buffer.concat([Buffer.from(SENTINEL), Buffer.from([1, 2])]))).toEqual({
      runAsNode: "removed",
      enableCookieEncryption: "removed",
    });
  });
});

describe("inspectDelivery", () => {
  it.each(["mac", "linux", "win"] as const)(
    "finds nothing wrong in a complete %s delivery",
    async (system) => {
      const root = await tempFolder();
      await writeDelivery(root, system);
      expect(await inspectDelivery(root, NAMES, system, NOTICES)).toEqual([]);
    },
  );

  it("lists every missing part of an empty folder", async () => {
    const root = await tempFolder();
    const cli = path.join("resources", "cli");
    expect(await inspectDelivery(root, NAMES, "linux", NOTICES)).toEqual([
      "missing: Tool",
      "missing: Tool",
      `missing: ${path.join("bin", "tool")}`,
      `missing: ${path.join(cli, "dist", "bin.js")}`,
      `missing: ${path.join(cli, "node_modules", "@t", "api", "package.json")}`,
      `missing: ${path.join(cli, "node_modules", "@t", "mcp", "package.json")}`,
      `missing: ${path.join(cli, "node_modules", "@t", "core", "dist", "code-fingerprint.json")}`,
      `missing: ${path.join(cli, "node_modules", "@t", "core", "dist", "model", "read-worker.js")}`,
      `missing: ${path.join("resources", "docs", "junit", "README.md")}`,
      `missing: ${path.join("resources", "THIRD_PARTY_NOTICES.txt")}`,
      `missing: ${path.join("resources", "app.asar")}`,
    ]);
  });

  it("finds lost executable bits, updaters, notices without the required names, asar gaps and wrong fuses", async () => {
    const root = await tempFolder();
    await writeDelivery(root, "linux");
    await fs.chmod(path.join(root, "chrome-sandbox"), 0o644);
    await fs.writeFile(path.join(root, "resources", "app-update.yml"), "provider: github\n");
    await fs.mkdir(path.join(root, "resources", "cli", "node_modules", "electron-updater"));
    await fs.writeFile(
      path.join(root, "resources", "THIRD_PARTY_NOTICES.txt"),
      "@dagrejs/dagre-extra 1.0.0\n",
    );
    await fs.writeFile(
      path.join(root, "resources", "app.asar"),
      asar({ files: { "package.json": {}, node_modules: { files: { "electron-updater": { files: {} } } } } }),
    );
    await fs.writeFile(path.join(root, "Tool"), binary("1010"));
    expect(await inspectDelivery(root, NAMES, "linux", NOTICES)).toEqual([
      ...(EXEC_BITS ? ["not executable: chrome-sandbox"] : []),
      `update configuration: ${path.join("resources", "app-update.yml")}`,
      "updater in the CLI: electron-updater",
      "third-party notices do not name @dagrejs/dagre",
      "third-party notices do not name @dagrejs/graphlib",
      "missing in app.asar: /out/main/index.js",
      "missing in app.asar: /node_modules/@t/core/dist/code-fingerprint.json",
      "updater in app.asar: electron-updater",
      "fuse enableNodeOptionsEnvironmentVariable is on, expected off",
      "fuse onlyLoadAppFromAsar is absent, expected on",
    ]);
  });

  it("does not check executable bits on a Windows host", async () => {
    const root = await tempFolder();
    await writeDelivery(root, "linux");
    await fs.chmod(path.join(root, "chrome-sandbox"), 0o644);
    expect(await inspectDelivery(root, NAMES, "linux", NOTICES, "win32")).toEqual([]);
  });

  it("finds source maps, type declarations and build info in the command line and in app.asar", async () => {
    const root = await tempFolder();
    await writeDelivery(root, "linux");
    const dist = path.join("resources", "cli", "dist");
    for (const file of ["bin.js.map", "bin.d.ts", "test.tsbuildinfo"]) {
      await fs.writeFile(path.join(root, dist, file), "");
    }
    const entry = { size: 1, offset: "0" };
    const main = { files: { "index.js": entry, "index.js.map": entry } };
    await fs.writeFile(
      path.join(root, "resources", "app.asar"),
      asar({ files: { ...GOOD_ASAR.files, out: { files: { main } } } }),
    );
    expect(await inspectDelivery(root, NAMES, "linux", NOTICES)).toEqual([
      `build leftover: ${path.join(dist, "bin.d.ts")}`,
      `build leftover: ${path.join(dist, "bin.js.map")}`,
      `build leftover: ${path.join(dist, "test.tsbuildinfo")}`,
      "build leftover in app.asar: /out/main/index.js.map",
    ]);
    expect(["a.d.mts", "a.d.cts", "a.js", "a.ts", "map.js"].map(isBuildLeftover)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });

  it("finds a binary without a fuse wire", async () => {
    const root = await tempFolder();
    await writeDelivery(root, "win");
    await fs.writeFile(path.join(root, "Tool.exe"), "MZ");
    expect(await inspectDelivery(root, NAMES, "win", NOTICES)).toEqual(["no fuse wire in Tool.exe"]);
  });
});

describe("installDelivery", () => {
  /** A tar.gz in a temporary folder with `entries` (folders) at its top. */
  const archive = async (...entries: string[]): Promise<string> => {
    const source = await tempFolder();
    for (const entry of entries) {
      await fs.mkdir(path.join(source, entry, "inside"), { recursive: true });
    }
    const file = path.join(await tempFolder(), "a.tar.gz");
    execFileSync(process.platform === "win32" ? WINDOWS_TAR : "tar", [
      "-czf",
      file,
      "-C",
      source,
      ...entries,
    ]);
    return file;
  };

  it("unpacks and gives the one folder of the archive", async () => {
    const dest = await tempFolder();
    expect(await installDelivery(await archive("Tool-0.3.0-linux-x64"), dest, NAMES)).toBe(
      path.join(dest, "Tool-0.3.0-linux-x64"),
    );
    expect((await fs.stat(path.join(dest, "Tool-0.3.0-linux-x64", "inside"))).isDirectory()).toBe(true);
  });

  it("gives the folder itself for the macOS app and for several top entries", async () => {
    const one = await tempFolder();
    expect(await installDelivery(await archive("Tool.app"), one, NAMES, "darwin")).toBe(one);
    const two = await tempFolder();
    expect(await installDelivery(await archive("a", "b"), two, NAMES, "linux")).toBe(two);
  });
});

describe("offline", () => {
  it("probes a connect in a separate process", async () => {
    const server = net.createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as net.AddressInfo;
    expect(await connectProbe("127.0.0.1", port)).toBe("connected");
    await new Promise((resolve) => server.close(resolve));
    expect(await connectProbe("127.0.0.1", port)).toBe("ECONNREFUSED");
  });

  it("names what shows a process is not in a namespace with loopback only", () => {
    expect(offlineProblems(["lo"], "ENETUNREACH")).toEqual([]);
    expect(offlineProblems(["lo", "eth0", "wlan0"], "connected")).toEqual([
      "network interfaces besides loopback: eth0, wlan0",
      "a connect to a public address gave connected, expected ENETUNREACH",
    ]);
  });
});
