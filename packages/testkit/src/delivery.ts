// The delivery of ADR-0020 as the tests see it (#2308): where each part lies in the unpacked archive of a system,
// how to unpack it, and an inspection that lists what is missing or wrong (SR-249 AK2). The names come from
// `toolchain/packaging/names.json`, the one place that names the product and its files.
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

/** The systems with one archive each (ADR-0020). */
export type DeliverySystem = "mac" | "linux" | "win";

export const DELIVERY_SYSTEMS: readonly DeliverySystem[] = ["mac", "linux", "win"];

/** `toolchain/packaging/names.json`. */
export interface DeliveryNames {
  readonly productName: string;
  readonly appId: string;
  readonly launcher: string;
  /** The desktop shell's own program (`reqseq-shell`); the release gives it the product's name on macOS and Windows. */
  readonly shellProgram: string;
  readonly packageScope: string;
  /** File name of the CLI tarball with `${version}`. */
  readonly cliTarball: string;
  /** File name pattern of the artifacts with `${productName}`, `${version}`, `${os}`, `${arch}`, `${ext}`. */
  readonly artifact: string;
  /** Name pattern of the one folder an archive holds, with the same placeholders but `${ext}`. */
  readonly folder: string;
}

/** The CPU architecture each system is built for (ADR-0020) and the Node names of system and CPU. */
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

/** A name pattern of names.json filled in for `system` and `version`. */
const deliveryName = (
  pattern: string,
  names: DeliveryNames,
  system: DeliverySystem,
  version: string,
): string => {
  const { arch, ext } = DELIVERY_TARGET[system];
  return pattern
    .replaceAll("${productName}", names.productName)
    .replaceAll("${version}", version)
    .replaceAll("${os}", system)
    .replaceAll("${arch}", arch)
    .replaceAll("${ext}", ext);
};

/** The file name of the artifact of `system` for `version`. */
export function deliveryArtifactName(names: DeliveryNames, system: DeliverySystem, version: string): string {
  return deliveryName(names.artifact, names, system, version);
}

/** The one folder the artifact of `system` holds. */
export function deliveryFolderName(names: DeliveryNames, system: DeliverySystem, version: string): string {
  return deliveryName(names.folder, names, system, version);
}

/** The file name of the CLI tarball for `version`. */
export function cliTarballName(names: DeliveryNames, version: string): string {
  return names.cliTarball.replaceAll("${version}", version);
}

/** Where the parts lie, relative to the unpacked folder of the archive (ADR-0020, ADR-0021). */
export interface DeliveryLayout {
  /** The desktop shell a person starts (SR-249 AK3): `<product>.app` on macOS, `<product>.exe` on Windows, `<product>` on Linux. */
  readonly shell: string;
  /** The program that starts the shell: the bundle's executable on macOS, else `shell`. */
  readonly shellStart: string;
  /** The shell's binary, which carries the build mark: `<shellProgram>` beside the Linux launcher, else `shellStart`. */
  readonly shellBinary: string;
  /** The bundle's `Info.plist` on macOS. */
  readonly infoPlist?: string;
  /** The folder of `bin/`, `runtime/` and `lib/`: `<product>.app/Contents/Resources` on macOS, else the unpacked folder. */
  readonly root: string;
  /** The launcher `bin/<launcher>` (`.cmd` on Windows). */
  readonly launcher: string;
  /** The shipped Node, the only file of `runtime/`. */
  readonly runtime: string;
  /** The command line with the MCP server and the UI server: the CLI package with its `node_modules`. */
  readonly lib: string;
  /** The pages of the web UI, which `reqseq ui` serves. */
  readonly web: string;
  /** The documentation site of this version (SR-141), which `reqseq serve docs` serves. */
  readonly docs: string;
  /** The example of connecting a test tool. */
  readonly examples: string;
  readonly notices: string;
  /** Files that must keep their executable bit in the archive. */
  readonly executables: readonly string[];
}

export function deliveryLayout(names: DeliveryNames, system: DeliverySystem): DeliveryLayout {
  const win = system === "win";
  const app = `${names.productName}.app`;
  const root = system === "mac" ? path.join(app, "Contents", "Resources") : "";
  const launcher = path.join(root, "bin", win ? `${names.launcher}.cmd` : names.launcher);
  const runtime = path.join(root, "runtime", win ? "node.exe" : "node");
  const shell = system === "mac" ? app : win ? `${names.productName}.exe` : names.productName;
  const shellStart = system === "mac" ? path.join(app, "Contents", "MacOS", names.productName) : shell;
  const shellBinary = system === "linux" ? names.shellProgram : shellStart;
  const lib = path.join(root, "lib");
  return {
    shell,
    shellStart,
    shellBinary,
    ...(system === "mac" ? { infoPlist: path.join(app, "Contents", "Info.plist") } : {}),
    root,
    launcher,
    runtime,
    lib,
    web: path.join(lib, "web"),
    docs: path.join(lib, "docs"),
    examples: path.join(root, "examples", "junit"),
    notices: path.join(root, "THIRD_PARTY_NOTICES.txt"),
    executables: win ? [] : [...new Set([launcher, runtime, shellStart, shellBinary])],
  };
}

/**
 * The text a release build of the shell carries (`packages/shell/shell/src/main.rs`): built with
 * `tauri/custom-protocol` and without the e2e driver (ADR-0021, Package).
 */
export const SHELL_RELEASE_MARK = "reqseq-shell build: release";
/** A variable only the e2e driver reads: the shipped shell must not hold it (ADR-0021, Test seam). */
export const SHELL_E2E_MARK = "REQSEQ_SHELL_E2E_NODE";

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
 * Installs the delivery: unpacks `artifact` into the empty folder `dest` (ADR-0020: installing is unpacking) and
 * returns the one folder the archive holds; `dest` itself when it holds more or less than one entry.
 */
export async function installDelivery(
  artifact: string,
  dest: string,
  host: NodeJS.Platform = process.platform,
): Promise<string> {
  const { command, args } = unpackCommand(artifact, dest, host);
  await promisify(execFile)(command, [...args]);
  const [only, ...more] = await fs.readdir(dest);
  return only !== undefined && more.length === 0 ? path.join(dest, only) : dest;
}

const exists = (file: string): Promise<boolean> =>
  fs.stat(file).then(
    () => true,
    () => false,
  );

/**
 * Build leftovers that must not ship (ThomasBirkmaier/ReqSeq-archive#324): source maps, type declarations and TypeScript build info. The
 * staging removes them; the inspection finds any that come back.
 */
export const isBuildLeftover = (file: string): boolean =>
  /\.(map|d\.ts|d\.mts|d\.cts|tsbuildinfo)$/.test(file);

/**
 * A file or folder of Electron or its packaging (SR-249 AK2: the delivery holds no Electron): the `electron`
 * package, `@electron/`, `electron-updater`, an Electron binary or framework, an asar archive, Chromium's sandbox helper;
 * a package that only has the word in its name, such as `electron-to-chromium`, is none.
 */
export const isElectronPart = (file: string): boolean =>
  file
    .split(/[\\/]/)
    .some(
      (name) =>
        /^(?:electron|electron\.exe|electron-updater|@electron|electron framework.*)$/i.test(name) ||
        name.endsWith(".asar") ||
        name === "chrome-sandbox",
    );

/** The files the delivery must hold, and the executable bits it must keep (not on a Windows `host`). */
async function fileFindings(
  root: string,
  names: DeliveryNames,
  layout: DeliveryLayout,
  host: NodeJS.Platform,
): Promise<string[]> {
  const scoped = (name: string, ...rest: string[]): string =>
    path.join(layout.lib, "node_modules", ...`${names.packageScope}${name}`.split("/"), ...rest);
  const required = [
    layout.launcher,
    layout.runtime,
    path.join(layout.lib, "dist", "bin.js"),
    scoped("api", "package.json"),
    scoped("mcp", "package.json"),
    scoped("core", "dist", "code-fingerprint.json"),
    scoped("core", "dist", "model", "read-worker.js"),
    scoped("core", "dist", "model", "agent-beat-worker.js"),
    path.join(layout.web, "index.html"),
    path.join(layout.docs, "index.html"),
    path.join(layout.docs, "search-index.json"),
    path.join(layout.examples, "README.md"),
    layout.notices,
    layout.shellStart,
    layout.shellBinary,
    ...(layout.infoPlist === undefined ? [] : [layout.infoPlist]),
  ];
  const findings: string[] = [];
  // On macOS and Windows the shell's binary is the program that starts it.
  for (const file of new Set(required)) {
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
  // The runtime is Node's binary alone: no npm, npx or corepack (ADR-0020).
  const runtime = await fs.readdir(path.join(root, path.dirname(layout.runtime))).catch(() => []);
  for (const file of runtime.filter((name) => name !== path.basename(layout.runtime)).sort()) {
    findings.push(`more than Node in the runtime: ${path.join(path.dirname(layout.runtime), file)}`);
  }
  const files = (await fs.readdir(root, { recursive: true })).sort();
  for (const file of files.filter(isElectronPart)) {
    findings.push(`Electron: ${file}`);
  }
  for (const file of files.filter(isBuildLeftover)) {
    findings.push(`build leftover: ${file}`);
  }
  return findings;
}

/** The value of `key` in an `Info.plist` (a `<string>` right after its `<key>`); undefined without it. */
export const plistString = (plist: string, key: string): string | undefined =>
  new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(plist)?.[1];

/**
 * The shell is the release build (SR-249 AK3, ADR-0021): its binary carries the release mark and not the e2e
 * driver, and on macOS the bundle's `Info.plist` names its executable and the app id.
 */
async function shellFindings(root: string, names: DeliveryNames, layout: DeliveryLayout): Promise<string[]> {
  const findings: string[] = [];
  const binary = await fs.readFile(path.join(root, layout.shellBinary)).catch(() => undefined);
  if (binary !== undefined) {
    if (!binary.includes(SHELL_RELEASE_MARK)) {
      findings.push(`not a release build of the shell: ${layout.shellBinary}`);
    }
    if (binary.includes(SHELL_E2E_MARK)) {
      findings.push(`the shell holds the e2e driver: ${layout.shellBinary}`);
    }
  }
  const plist =
    layout.infoPlist === undefined
      ? undefined
      : await fs.readFile(path.join(root, layout.infoPlist), "utf8").catch(() => undefined);
  if (plist !== undefined) {
    const expected = {
      CFBundleExecutable: path.basename(layout.shellStart),
      CFBundleIdentifier: names.appId,
    };
    for (const [key, value] of Object.entries(expected)) {
      if (plistString(plist, key) !== value) {
        findings.push(`${String(layout.infoPlist)} does not give ${key} ${value}`);
      }
    }
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

/**
 * What is missing or wrong in the installed delivery at `root` (empty: none): the launcher, the runtime, the
 * command line, the MCP server and the UI server with the pages of the web UI (SR-249 AK2), the fingerprint and
 * workers of core, the example for test tools, the documentation site with its search (SR-141), the third-party
 * notices naming `requiredNotices` (ADR-0015), nothing of Electron and no npm in the runtime (SR-249 AK2,
 * ADR-0020), no build leftovers, the executable bits (not checked on a Windows `host`), and the desktop shell at its
 * place as a release build (SR-249 AK3).
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
    ...(await shellFindings(root, names, layout)),
    ...(await noticeFindings(path.join(root, layout.notices), requiredNotices)),
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
