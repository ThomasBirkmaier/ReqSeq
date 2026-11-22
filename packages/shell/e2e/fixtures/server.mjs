// Stand-ins for the CLI entry in the e2e tests of SR-252 AK5 (`REQSEQ_SHELL_E2E_CLI`), started as the shell starts
// the real one: `node server.mjs ui --no-open`. `REQSEQ_FAKE` says how it behaves; `REQSEQ_FAKE_PID` names a file
// for its process ID.
import fs from "node:fs";
import http from "node:http";
import { setInterval, setTimeout } from "node:timers";

const mode = process.env["REQSEQ_FAKE"] ?? "";
const pidFile = process.env["REQSEQ_FAKE_PID"];
if (pidFile !== undefined) {
  fs.writeFileSync(pidFile, String(process.pid));
}
// It never ends on its own input, so the shell has to kill it.
const forever = () => setInterval(() => undefined, 60_000);

if (mode === "fails") {
  // 3,000 characters on standard error, of which only the last 2,000 are the reason.
  process.stderr.write(`HEAD${"x".repeat(2_996)}`);
  process.stderr.write("\nError: the port is taken\n");
  process.exit(1);
} else if (mode === "silent") {
  forever();
} else if (mode === "elsewhere") {
  process.stdout.write("ReqSeq UI on http://192.0.2.1:8080/#token=abcdefgh\n");
  forever();
} else if (mode === "ends") {
  const server = http.createServer((_, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>Fake</title><p>fake server</p>");
  });
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    process.stdout.write(`ReqSeq UI on http://127.0.0.1:${String(port)}/#token=fakeToken123\n`);
    setTimeout(
      () => {
        process.stderr.write("Error: the server stopped\n");
        process.exit(7);
      },
      Number(process.env["REQSEQ_FAKE_AFTER_MS"] ?? "3000"),
    );
  });
}
