// The delivery of ADR-0014 as the tests see it (#324): where each part lies in the unpacked artifact of a
// system, how to unpack it, and an inspection that lists what is missing or wrong (SR-076 AK2). The names
// come from `toolchain/packaging/names.json`, the one place that names the product and its files.
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

/** The systems with one artifact each (ADR-0014). */
export type DeliverySystem = "mac" | "linux" | "win";

export const DELIVERY_SYSTEMS: readonly DeliverySystem[] = ["mac", "linux", "win"];

/** `toolchain/packaging/names.json`. */
export interface DeliveryNames {
  readonly productName: string;
  readonly appId: string;
  readonly launcher: string;
  readonly packageScope: string;
  /** File name of the CLI tarball with `${version}`. */
  readonly cliTarball: string;
  /** File name pattern of the artifacts with `${productName}`, `${version}`, `${os}`, `${arch}`, `${ext}`. */
  readonly artifact: string;
}

/** The CPU architecture each system is built for (ADR-0014) and the Node names of system and CPU. */
export const DELIVERY_TARGET: Readonly<
  Record<
    DeliverySystem,
    { readonly arch: string; readonly ext: string; readonly platform: NodeJS.Platform; readonly cpu: string }
  >
> = {
  mac: { arch: "arm64", ext: "zip", platform: "darwin", cpu: "arm64" },
  linux: { arch: "x64", ext: "tar.gz", platform: "linux", cpu: "x64" },
  win: { arch: "x64", ext: "zip", platform: "win32", cpu: "x64" },
};

/** The file name of the artifact of `system` for `version`. */
export function deliveryArtifactName(names: DeliveryNames, system: DeliverySystem, version: string): string {
  const { arch, ext } = DELIVERY_TARGET[system];
  return names.artifact
    .replaceAll("${productName}", names.productName)
    .replaceAll("${version}", version)
    .replaceAll("${os}", system)
    .replaceAll("${arch}", arch)
    .replaceAll("${ext}", ext);
}

/** The file name of the CLI tarball for `version`. */
export function cliTarballName(names: DeliveryNames, version: string): string {
  return names.cliTarball.replaceAll("${version}", version);
}

/**
 * Where the parts lie, relative to the installed folder: the folder that holds `<product>.app` on macOS,
 * the unpacked delivery folder on Linux and Windows.
 */
export interface DeliveryLayout {
  /** The app's binary, also the runtime of the launcher. */
  readonly app: string;
  /** The binary that holds Electron's fuses (on macOS the framework, elsewhere the app binary). */
  readonly fuseBinary: string;
  readonly launcher: string;
  readonly resources: string;
  /** Files that must keep their executable bit in the archive. */
  readonly executables: readonly string[];
}

export function deliveryLayout(names: DeliveryNames, system: DeliverySystem): DeliveryLayout {
  const product = names.productName;
  if (system === "mac") {
    const contents = path.join(`${product}.app`, "Contents");
    const app = path.join(contents, "MacOS", product);
    const launcher = path.join(contents, "Resources", "bin", names.launcher);
    return {
      app,
      fuseBinary: path.join(contents, "Frameworks", "Electron Framework.framework", "Electron Framework"),
      launcher,
      resources: path.join(contents, "Resources"),
      executables: [app, launcher],
    };
  }
  if (system === "win") {
    const app = `${product}.exe`;
    return {
      app,
      fuseBinary: app,
      launcher: path.join("bin", `${names.launcher}.cmd`),
      resources: "resources",
      executables: [],
    };
  }
  const launcher = path.join("bin", names.launcher);
  return {
    app: product,
    fuseBinary: product,
    launcher,
    resources: "resources",
    executables: [product, launcher, "chrome-sandbox"],
  };
}

/**
 * Windows' own bsdtar: it reads zip and tar.gz and takes Windows paths. A `tar` of Git Bash, which may come
 * earlier on the PATH, reads neither a zip nor such a path.
 */
export const WINDOWS_TAR = "C:\\Windows\\System32\\tar.exe";

/** The command that unpacks `artifact` into the existing folder `dest` on `host`. */
export function unpackCommand(
  artifact: string,
  dest: string,
  host: NodeJS.Platform,
): { readonly command: string; readonly args: readonly string[] } {
  if (host === "win32") {
    return { command: WINDOWS_TAR, args: ["-xf", artifact, "-C", dest] };
  }
  if (artifact.endsWith(".tar.gz") || artifact.endsWith(".tgz")) {
    return { command: "tar", args: ["-xzf", artifact, "-C", dest] };
  }
  if (host === "darwin") {
    // ditto keeps the symbolic links and attributes of an app bundle.
    return { command: "ditto", args: ["-x", "-k", artifact, dest] };
  }
  return { command: "unzip", args: ["-q", "-o", artifact, "-d", dest] };
}

/**
 * Installs the delivery: unpacks `artifact` into the empty folder `dest` (ADR-0014: installing is unpacking)
 * and returns the installed folder: the one folder the archive holds (Linux, Windows), else `dest` (the
 * folder that holds the macOS app).
 */
export async function installDelivery(
  artifact: string,
  dest: string,
  names: DeliveryNames,
  host: NodeJS.Platform = process.platform,
): Promise<string> {
  const { command, args } = unpackCommand(artifact, dest, host);
  await promisify(execFile)(command, [...args]);
  const [only, ...more] = await fs.readdir(dest);
  return only !== undefined && more.length === 0 && only !== `${names.productName}.app`
    ? path.join(dest, only)
    : dest;
}

/** The paths of all entries in an asar header (the JSON of `@electron/asar`), with a leading `/`. */
export function asarEntries(header: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown, prefix: string): void => {
    const files = (node as { files?: Record<string, unknown> } | null)?.files;
    if (files === undefined) {
      return;
    }
    for (const [name, child] of Object.entries(files)) {
      out.push(`${prefix}/${name}`);
      walk(child, `${prefix}/${name}`);
    }
  };
  walk(header, "");
  return out;
}

/** Reads the header of an asar archive: a pickle with its size, then a pickle with the JSON string. */
export async function readAsarHeader(file: string): Promise<unknown> {
  const handle = await fs.open(file, "r");
  try {
    const size = Buffer.alloc(8);
    await handle.read(size, 0, 8, 0);
    const header = Buffer.alloc(size.readUInt32LE(4));
    await handle.read(header, 0, header.length, 8);
    const length = header.readUInt32LE(4);
    return JSON.parse(header.toString("utf8", 8, 8 + length)) as unknown;
  } finally {
    await handle.close();
  }
}

/** The fuses of `@electron/fuses` (FuseV1Options), in the order of the fuse wire. */
export const FUSES = [
  "runAsNode",
  "enableCookieEncryption",
  "enableNodeOptionsEnvironmentVariable",
  "enableNodeCliInspectArguments",
  "enableEmbeddedAsarIntegrityValidation",
  "onlyLoadAppFromAsar",
] as const;
export type Fuse = (typeof FUSES)[number];
export type FuseState = "on" | "off" | "removed";

/** Electron's fuse sentinel; the wire follows it: version, length, one byte per fuse. */
const SENTINEL = Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX");

/** The fuses of an Electron binary, or undefined when it has no fuse wire. */
export function readFuses(binary: Buffer): Partial<Record<Fuse, FuseState>> | undefined {
  const at = binary.indexOf(SENTINEL);
  if (at < 0) {
    return undefined;
  }
  const wire = at + SENTINEL.length;
  const length = binary[wire + 1] ?? 0;
  const out: Partial<Record<Fuse, FuseState>> = {};
  for (const [index, fuse] of FUSES.entries()) {
    if (index < length) {
      const byte = binary[wire + 2 + index];
      out[fuse] = byte === 0x31 ? "on" : byte === 0x30 ? "off" : "removed";
    }
  }
  return out;
}

/** The fuses ADR-0014 sets. */
export const EXPECTED_FUSES: Readonly<Partial<Record<Fuse, FuseState>>> = {
  runAsNode: "on",
  enableNodeOptionsEnvironmentVariable: "off",
  enableNodeCliInspectArguments: "off",
  onlyLoadAppFromAsar: "on",
};

const exists = (file: string): Promise<boolean> =>
  fs.stat(file).then(
    () => true,
    () => false,
  );

/**
 * Build leftovers that must not ship (#324): source maps, type declarations and TypeScript build info. The
 * staging removes them; the inspection finds any that come back.
 */
export const isBuildLeftover = (file: string): boolean =>
  /\.(map|d\.ts|d\.mts|d\.cts|tsbuildinfo)$/.test(file);

/** The files the delivery must hold, and the executable bits it must keep (not on a Windows `host`). */
async function fileFindings(
  root: string,
  names: DeliveryNames,
  layout: DeliveryLayout,
  host: NodeJS.Platform,
): Promise<string[]> {
  const cli = path.join(layout.resources, "cli");
  const scoped = (name: string, ...rest: string[]): string =>
    path.join(cli, "node_modules", ...`${names.packageScope}${name}`.split("/"), ...rest);
  const required = [
    layout.app,
    layout.fuseBinary,
    layout.launcher,
    path.join(cli, "dist", "bin.js"),
    scoped("api", "package.json"),
    scoped("mcp", "package.json"),
    scoped("core", "dist", "code-fingerprint.json"),
    scoped("core", "dist", "model", "read-worker.js"),
    path.join(layout.resources, "docs", "junit", "README.md"),
    path.join(layout.resources, "THIRD_PARTY_NOTICES.txt"),
    path.join(layout.resources, "app.asar"),
  ];
  const findings: string[] = [];
  for (const file of required) {
    if (!(await exists(path.join(root, file)))) {
      findings.push(`missing: ${file}`);
    }
  }
  // NTFS has no execute bits: Node on Windows reports none for any file, so they cannot be checked there.
  for (const file of host === "win32" ? [] : layout.executables) {
    const stat = await fs.stat(path.join(root, file)).catch(() => undefined);
    if (stat !== undefined && (stat.mode & 0o111) === 0) {
      findings.push(`not executable: ${file}`);
    }
  }
  if (await exists(path.join(root, layout.resources, "app-update.yml"))) {
    findings.push(`update configuration: ${path.join(layout.resources, "app-update.yml")}`);
  }
  if (await exists(path.join(root, cli, "node_modules", "electron-updater"))) {
    findings.push("updater in the CLI: electron-updater");
  }
  const files = await fs.readdir(path.join(root, cli), { recursive: true }).catch(() => []);
  for (const file of files.filter(isBuildLeftover).sort()) {
    findings.push(`build leftover: ${path.join(cli, file)}`);
  }
  return findings;
}

/** The notices must name `required` (ADR-0015). */
async function noticeFindings(file: string, required: readonly string[]): Promise<string[]> {
  const notices = await fs.readFile(file, "utf8").catch(() => undefined);
  return notices === undefined
    ? []
    : required
        .filter((name) => !notices.includes(`${name} `))
        .map((name) => `third-party notices do not name ${name}`);
}

/** The app archive must hold the app and core's fingerprint, and no updater. */
async function asarFindings(file: string, names: DeliveryNames): Promise<string[]> {
  const header = await readAsarHeader(file).catch(() => undefined);
  if (header === undefined) {
    return [];
  }
  const entries = new Set(asarEntries(header));
  const findings = [
    "/package.json",
    "/out/main/index.js",
    `/node_modules/${names.packageScope}core/dist/code-fingerprint.json`,
  ]
    .filter((entry) => !entries.has(entry))
    .map((entry) => `missing in app.asar: ${entry}`);
  if (entries.has("/node_modules/electron-updater")) {
    findings.push("updater in app.asar: electron-updater");
  }
  for (const entry of [...entries].filter(isBuildLeftover).sort()) {
    findings.push(`build leftover in app.asar: ${entry}`);
  }
  return findings;
}

/** The fuses of ADR-0014. */
async function fuseFindings(root: string, fuseBinary: string): Promise<string[]> {
  const binary = await fs.readFile(path.join(root, fuseBinary)).catch(() => undefined);
  if (binary === undefined) {
    return [];
  }
  const fuses = readFuses(binary);
  if (fuses === undefined) {
    return [`no fuse wire in ${fuseBinary}`];
  }
  return Object.entries(EXPECTED_FUSES)
    .filter(([fuse, state]) => fuses[fuse as Fuse] !== state)
    .map(([fuse, state]) => `fuse ${fuse} is ${fuses[fuse as Fuse] ?? "absent"}, expected ${state}`);
}

/**
 * What is missing or wrong in the installed delivery at `root` (empty: none): app, launcher, CLI and MCP
 * server (SR-076 AK2), the fingerprint and read worker of core, the guide for test tools, the third-party
 * notices naming `requiredNotices` (ADR-0015), no update configuration (SR-078), no build leftovers, the
 * fuses and the executable bits (ADR-0014; not checked on a Windows `host`).
 */
export async function inspectDelivery(
  root: string,
  names: DeliveryNames,
  system: DeliverySystem,
  requiredNotices: readonly string[],
  host: NodeJS.Platform = process.platform,
): Promise<string[]> {
  const layout = deliveryLayout(names, system);
  return [
    ...(await fileFindings(root, names, layout, host)),
    ...(await noticeFindings(path.join(root, layout.resources, "THIRD_PARTY_NOTICES.txt"), requiredNotices)),
    ...(await asarFindings(path.join(root, layout.resources, "app.asar"), names)),
    ...(await fuseFindings(root, layout.fuseBinary)),
  ];
}

/**
 * The error code of a TCP connect to `host`:`port`, made by a separate Node process (a test process may block
 * the network in its own process), or "connected". Used to show that a test runs without network.
 */
export async function connectProbe(host: string, port: number): Promise<string> {
  const script = [
    `const socket = require("node:net").connect(${String(port)}, ${JSON.stringify(host)});`,
    "socket.setTimeout(5000);",
    'socket.on("connect", () => { console.log("connected"); socket.destroy(); });',
    'socket.on("timeout", () => { console.log("ETIMEDOUT"); socket.destroy(); });',
    'socket.on("error", (error) => console.log(error.code));',
  ].join("\n");
  const { stdout } = await promisify(execFile)(process.execPath, ["-e", script]);
  return stdout.trim();
}

/**
 * Why a process does not run in a network namespace with loopback only (empty: it does), from the names of
 * its network interfaces and the result of a connect to a public address (`connectProbe`), which must be
 * ENETUNREACH (SR-078 AK2: the delivery is installed without network).
 */
export function offlineProblems(interfaces: readonly string[], probe: string): string[] {
  const others = interfaces.filter((name) => name !== "lo");
  return [
    ...(others.length > 0 ? [`network interfaces besides loopback: ${others.join(", ")}`] : []),
    ...(probe === "ENETUNREACH" ? [] : [`a connect to a public address gave ${probe}, expected ENETUNREACH`]),
  ];
}
