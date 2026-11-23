// Probe #2465: one connection to a documentation address over IPv4 and IPv6 and one name lookup, so the
// recorders show whether they see and refuse anything. Argument: a label.
import net from "node:net";
import dns from "node:dns";
import fs from "node:fs";
import path from "node:path";

const label = process.argv[2] ?? "control";
fs.mkdirSync(path.join(process.env.PROBE, "private"), { recursive: true });
fs.writeFileSync(path.join(process.env.PROBE, "private", `pid-${label}`), String(process.pid));
const t0 = Date.now();
const connect = (host) =>
  new Promise((resolve) => {
    const s = net.connect({ host, port: 80 });
    const done = (what) => {
      s.destroy();
      resolve(`${what} after ${Date.now() - start} ms`);
    };
    const start = Date.now();
    s.setTimeout(5_000, () => done("timeout"));
    s.once("connect", () => done("connected"));
    s.once("error", (e) => done(`error ${e.code}`));
  });
const lookup = (name) =>
  new Promise((resolve) => {
    dns.lookup(name, { all: true }, (e, a) => resolve(e ? `error ${e.code}` : JSON.stringify(a)));
  });
console.log(`control ${label} pid ${process.pid} execPath ${process.execPath}`);
console.log(`  v4 192.0.2.1:80     ${await connect("192.0.2.1")}`);
console.log(`  v6 [2001:db8::1]:80 ${await connect("2001:db8::1")}`);
console.log(`  dns probe-2465-${label}.example.com ${await lookup(`probe-2465-${label}.example.com`)}`);
console.log(`  took ${Date.now() - t0} ms at ${new Date().toISOString()}`);
