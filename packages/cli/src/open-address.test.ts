// The opener of `reqseq ui` with a fake `spawn`; the e2e suite starts a stand-in on PATH (test/e2e/ui.test.ts).
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { Spawn } from "./open-address.js";
import { openAddress, openerOf } from "./open-address.js";

class FakeChild extends EventEmitter {
  unrefed = false;
  unref(): void {
    this.unrefed = true;
  }
}

const URL = "http://127.0.0.1:4317/#token=abc";

/** A spawn that records its call and hands out the child, which the test then ends. */
const fake = (): { spawn: Spawn; child: FakeChild; calls: unknown[][] } => {
  const child = new FakeChild();
  const calls: unknown[][] = [];
  return {
    child,
    calls,
    spawn: (command, args, options) => {
      calls.push([command, args, options]);
      return child;
    },
  };
};

describe("openAddress", () => {
  it("names the system's program for opening an address", () => {
    expect(openerOf("darwin")).toEqual({ command: "open", args: [] });
    expect(openerOf("win32")).toEqual({ command: "rundll32.exe", args: ["url.dll,FileProtocolHandler"] });
    expect(openerOf("linux")).toEqual({ command: "xdg-open", args: [] });
    expect(openerOf("freebsd")).toEqual({ command: "xdg-open", args: [] });
  });

  it("starts it without a shell with the address as one argument, does not wait for it, and resolves when it ends well", async () => {
    const { spawn, child, calls } = fake();
    const opened = openAddress(URL, "win32", spawn);
    expect(calls).toEqual([
      [
        "rundll32.exe",
        ["url.dll,FileProtocolHandler", URL],
        { detached: true, stdio: "ignore", windowsHide: true },
      ],
    ]);
    expect(child.unrefed).toBe(true);
    // Windows' handler reports no result: any code counts as opened.
    child.emit("exit", 1);
    await expect(opened).resolves.toBeUndefined();
    const linux = fake();
    const done = openAddress(URL, "linux", linux.spawn);
    linux.child.emit("exit", 0);
    await expect(done).resolves.toBeUndefined();
  });

  it("rejects with the reason when the program cannot start or fails", async () => {
    const missing = fake();
    const notStarted = openAddress(URL, "linux", missing.spawn);
    missing.child.emit("error", new Error("spawn xdg-open ENOENT"));
    await expect(notStarted).rejects.toThrow("xdg-open could not be started: spawn xdg-open ENOENT");
    const failing = fake();
    const failed = openAddress(URL, "darwin", failing.spawn);
    failing.child.emit("exit", 3);
    await expect(failed).rejects.toThrow("open ended with code 3");
  });
});
