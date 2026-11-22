// Probes of the ports a server of the CLI listens on, for the e2e tests that check that other machines cannot
// reach it (SR-079 AK2, SR-247 AK4).
import { spawn } from "node:child_process";
import os from "node:os";

/**
 * The addresses of this machine that other machines can reach: not loopback, and no IPv6 link-local
 * addresses (they need a zone). Inside `unshare -rn` on Linux CI the dummy address 198.51.100.1 (ci.yml); the
 * CI runners of macOS and Windows have their own.
 */
export const externalAddresses = (): string[] =>
  Object.values(os.networkInterfaces())
    .flatMap((list) => list ?? [])
    .filter((info) => !info.internal && !info.address.toLowerCase().startsWith("fe80:"))
    .map((info) => info.address);

/**
 * Connect to `port` on each address in a separate Node process, which has no network block: this process
 * fails every connection to an address that is not loopback. The addresses are this machine's own, so
 * nothing leaves the machine. Prints one result per address: "connected", "timeout" or the error code.
 */
const PROBE = `
const net = require("node:net");
const [port, ...hosts] = process.argv.slice(1);
Promise.all(hosts.map((host) => new Promise((resolve) => {
  const socket = net.connect({ host, port: Number(port), timeout: 3000 });
  socket.once("connect", () => { socket.destroy(); resolve("connected"); });
  socket.once("timeout", () => { socket.destroy(); resolve("timeout"); });
  socket.once("error", (error) => resolve(String(error.code)));
}))).then((results) => console.log(JSON.stringify(results)));
`;

export const probe = (port: number, hosts: readonly string[]): Promise<string[]> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", PROBE, String(port), ...hosts], { stdio: "pipe" });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
    child.on("error", reject);
    child.on("exit", () => {
      resolve(JSON.parse(out) as string[]);
    });
  });
