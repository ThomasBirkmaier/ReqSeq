// Test setup: any connection that leaves the machine fails the test (SR-077, SR-078, ADR-0011).
// Loopback stays allowed because API tests talk to 127.0.0.1.
import net from "node:net";
import dns from "node:dns";

const isLoopback = (host) =>
  host === "localhost" || host === "::1" || /^127\./.test(host) || /^::ffff:127\./.test(host);
const fail = (target) => {
  throw new Error(`network access blocked in tests: ${target}`);
};

// Socket#connect is called as connect(options[, cb]), connect(port[, host][, cb]), connect(path[, cb]),
// or by net.connect/http/fetch with Node's normalized argument array as first argument.
const target = (args) => {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (typeof first === "string") {
    return { path: first };
  }
  if (typeof first === "number" || (typeof first === "string" && /^\d+$/.test(first))) {
    return { port: first, host: typeof args[1] === "string" ? args[1] : undefined };
  }
  return first ?? {};
};

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const t = target(args);
  if (!t.path && !isLoopback(t.host ?? "localhost")) {
    fail(`${t.host}:${t.port}`);
  }
  return connect.apply(this, args);
};

for (const api of [dns, dns.promises]) {
  for (const fn of ["lookup", "resolve", "resolve4", "resolve6"]) {
    const orig = api[fn];
    api[fn] = function (host, ...rest) {
      if (!isLoopback(host)) {
        fail(`dns ${host}`);
      }
      return orig.call(this, host, ...rest);
    };
  }
}
