// The program the system names for opening an address (`reqseq ui`, SR-247 AK1, ADR-0020 "Start and stop"):
// started without a shell, with the address as one argument, and not waited for.
import { spawn } from "node:child_process";

/** The program and its arguments before the address, per platform. */
export const openerOf = (
  platform: NodeJS.Platform,
): { readonly command: string; readonly args: readonly string[] } => {
  if (platform === "darwin") {
    return { command: "open", args: [] };
  }
  if (platform === "win32") {
    // `start` is a builtin of cmd.exe; this hands the address to the shell's handler without a shell.
    return { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler"] };
  }
  return { command: "xdg-open", args: [] };
};

/** What starts a program; `spawn` of `node:child_process` by default, a fake in tests. */
export type Spawn = (
  command: string,
  args: readonly string[],
  options: { readonly detached: true; readonly stdio: "ignore"; readonly windowsHide: true },
) => {
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "exit", listener: (code: number | null) => void): unknown;
  unref(): void;
};

/**
 * Starts the opener of `platform` for `url`. Resolves once it ended well, rejects with the reason when it could
 * not be started or, except on Windows (whose handler reports no result), ended with another code than 0.
 */
export function openAddress(
  url: string,
  platform: NodeJS.Platform = process.platform,
  start: Spawn = (command, args, options) => spawn(command, [...args], options),
): Promise<void> {
  const { command, args } = openerOf(platform);
  return new Promise((resolve, reject) => {
    const child = start(command, [...args, url], { detached: true, stdio: "ignore", windowsHide: true });
    child.once("error", (error) => {
      reject(new Error(`${command} could not be started: ${error.message}`));
    });
    child.once("exit", (code) => {
      if (code === 0 || platform === "win32") {
        resolve();
      } else {
        reject(new Error(`${command} ended with code ${String(code)}`));
      }
    });
    // The server does not wait for the browser.
    child.unref();
  });
}
