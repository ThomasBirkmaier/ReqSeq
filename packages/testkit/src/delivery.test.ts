import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DeliveryNames, DeliverySystem } from "./delivery.js";
import {
  WINDOWS_TAR,
  cliTarballName,
  connectProbe,
  deliveryArtifactName,
  deliveryFolderName,
  deliveryLayout,
  inspectDelivery,
  installDelivery,
  isBuildLeftover,
  isElectronPart,
  offlineProblems,
  unpackCommand,
} from "./delivery.js";

const NAMES: DeliveryNames = {
  productName: "Tool",
  appId: "org.example.tool",
  launcher: "tool",
  packageScope: "@t/",
  cliTarball: "tool-cli-${version}.tgz",
  artifact: "${productName}-${version}-${os}-${arch}.${ext}",
  folder: "${productName}-${version}-${os}-${arch}",
};
const NOTICES = ["katex", "Node.js"];
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

/** Writes an installed delivery of `system` at `root` that passes the inspection. */
const writeDelivery = async (root: string, system: DeliverySystem): Promise<void> => {
  const layout = deliveryLayout(NAMES, system);
  const write = async (file: string, content: string, mode = 0o644): Promise<void> => {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), content, { mode });
  };
  const lib = layout.lib;
  await write(layout.launcher, "#!/bin/sh\n", 0o755);
  await write(layout.runtime, "ELF", 0o755);
  await write(path.join(lib, "dist", "bin.js"), "");
  await write(path.join(lib, "node_modules", "@t", "api", "package.json"), "{}");
  await write(path.join(lib, "node_modules", "@t", "mcp", "package.json"), "{}");
  await write(path.join(lib, "node_modules", "@t", "core", "dist", "code-fingerprint.json"), "{}");
  await write(path.join(lib, "node_modules", "@t", "core", "dist", "model", "read-worker.js"), "");
  await write(path.join(lib, "node_modules", "@t", "core", "dist", "model", "agent-beat-worker.js"), "");
  await write(path.join(layout.web, "index.html"), "");
  await write(path.join(layout.docs, "index.html"), "");
  await write(path.join(layout.docs, "search-index.json"), "{}");
  await write(path.join("examples", "junit", "README.md"), "");
  await write(layout.notices, "katex 0.19.0\n\nNode.js 22.23.5\n");
};

describe("names", () => {
  it("names the artifact of every system and the CLI tarball", () => {
    expect(deliveryArtifactName(NAMES, "mac", "0.3.0")).toBe("Tool-0.3.0-mac-arm64.zip");
    expect(deliveryArtifactName(NAMES, "linux", "0.3.0")).toBe("Tool-0.3.0-linux-x64.tar.gz");
    expect(deliveryArtifactName(NAMES, "win", "0.3.0")).toBe("Tool-0.3.0-win-x64.zip");
    expect(cliTarballName(NAMES, "0.3.0")).toBe("tool-cli-0.3.0.tgz");
  });

  it("names the one folder of each archive", () => {
    expect(deliveryFolderName(NAMES, "mac", "0.3.0")).toBe("Tool-0.3.0-mac-arm64");
    expect(deliveryFolderName(NAMES, "win", "0.3.0")).toBe("Tool-0.3.0-win-x64");
  });

  it("lays out the launcher, the runtime, the program, the pages, the documentation and the notices per system", () => {
    const common = {
      lib: "lib",
      web: path.join("lib", "web"),
      docs: path.join("lib", "docs"),
      notices: "THIRD_PARTY_NOTICES.txt",
    };
    for (const system of ["mac", "linux"] as const) {
      expect(deliveryLayout(NAMES, system)).toEqual({
        launcher: path.join("bin", "tool"),
        runtime: path.join("runtime", "node"),
        ...common,
        executables: [path.join("bin", "tool"), path.join("runtime", "node")],
      });
    }
    expect(deliveryLayout(NAMES, "win")).toEqual({
      launcher: path.join("bin", "tool.cmd"),
      runtime: path.join("runtime", "node.exe"),
      ...common,
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
    const modules = path.join("lib", "node_modules", "@t");
    expect(await inspectDelivery(root, NAMES, "linux", NOTICES)).toEqual([
      `missing: ${path.join("bin", "tool")}`,
      `missing: ${path.join("runtime", "node")}`,
      `missing: ${path.join("lib", "dist", "bin.js")}`,
      `missing: ${path.join(modules, "api", "package.json")}`,
      `missing: ${path.join(modules, "mcp", "package.json")}`,
      `missing: ${path.join(modules, "core", "dist", "code-fingerprint.json")}`,
      `missing: ${path.join(modules, "core", "dist", "model", "read-worker.js")}`,
      `missing: ${path.join(modules, "core", "dist", "model", "agent-beat-worker.js")}`,
      `missing: ${path.join("lib", "web", "index.html")}`,
      `missing: ${path.join("lib", "docs", "index.html")}`,
      `missing: ${path.join("lib", "docs", "search-index.json")}`,
      `missing: ${path.join("examples", "junit", "README.md")}`,
      "missing: THIRD_PARTY_NOTICES.txt",
    ]);
  });

  it("finds lost executable bits, npm in the runtime, Electron, and notices without the required names", async () => {
    const root = await tempFolder();
    await writeDelivery(root, "linux");
    await fs.chmod(path.join(root, "runtime", "node"), 0o644);
    await fs.writeFile(path.join(root, "runtime", "npm"), "");
    await fs.mkdir(path.join(root, "lib", "node_modules", "electron-updater"));
    await fs.writeFile(path.join(root, "app.asar"), "");
    await fs.writeFile(path.join(root, "THIRD_PARTY_NOTICES.txt"), "katex-extra 1.0.0\n");
    expect(await inspectDelivery(root, NAMES, "linux", NOTICES)).toEqual([
      ...(EXEC_BITS ? [`not executable: ${path.join("runtime", "node")}`] : []),
      `more than Node in the runtime: ${path.join("runtime", "npm")}`,
      "Electron: app.asar",
      `Electron: ${path.join("lib", "node_modules", "electron-updater")}`,
      "third-party notices do not name katex",
      "third-party notices do not name Node.js",
    ]);
    expect(["chrome-sandbox", "a/Electron Framework", "b/plain.md"].map(isElectronPart)).toEqual([
      true,
      true,
      false,
    ]);
  });

  it("does not check executable bits on a Windows host", async () => {
    const root = await tempFolder();
    await writeDelivery(root, "linux");
    await fs.chmod(path.join(root, "runtime", "node"), 0o644);
    expect(await inspectDelivery(root, NAMES, "linux", NOTICES, "win32")).toEqual([]);
  });

  it("finds source maps, type declarations and build info", async () => {
    const root = await tempFolder();
    await writeDelivery(root, "linux");
    const dist = path.join("lib", "dist");
    for (const file of ["bin.js.map", "bin.d.ts", "test.tsbuildinfo"]) {
      await fs.writeFile(path.join(root, dist, file), "");
    }
    expect(await inspectDelivery(root, NAMES, "linux", NOTICES)).toEqual([
      `build leftover: ${path.join(dist, "bin.d.ts")}`,
      `build leftover: ${path.join(dist, "bin.js.map")}`,
      `build leftover: ${path.join(dist, "test.tsbuildinfo")}`,
    ]);
    expect(["a.d.mts", "a.d.cts", "a.js", "a.ts", "map.js"].map(isBuildLeftover)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
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
    expect(await installDelivery(await archive("Tool-0.3.0-linux-x64"), dest)).toBe(
      path.join(dest, "Tool-0.3.0-linux-x64"),
    );
    expect((await fs.stat(path.join(dest, "Tool-0.3.0-linux-x64", "inside"))).isDirectory()).toBe(true);
  });

  it("gives the folder itself for several top entries", async () => {
    const two = await tempFolder();
    expect(await installDelivery(await archive("a", "b"), two)).toBe(two);
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
