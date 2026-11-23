// Probe #2465: starts the e2e shell once and prints its driver lines, standard error, exit and the processes
// around it. Options in PROBE_OPTS (JSON): label, capMs, env, node, wrap (command prefix; the variables then go
// through `env`), session (open a workspace, show an element, close the window).
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const o = JSON.parse(process.env.PROBE_OPTS ?? "{}");
const OUT = path.join(process.env.PROBE, "out");
const PRIV = path.join(process.env.PROBE, "private");
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(PRIV, { recursive: true });
const SHELL = process.env.PROBE_SHELL;
const CLI = process.env.PROBE_CLI;
const ROOT = process.env.PROBE_ROOT;
const win = process.platform === "win32";
const cap = o.capMs ?? 60_000;
const ELEMENT = "e8df96ea-a168-4d90-8d65-6328cee88fb3";
let token = null;
const redact = (s) => (token ? String(s).split(token).join("<TOKEN>") : String(s));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
  } catch (e) {
    return `(${cmd} failed: ${String(e.message).split("\n")[0]})\n${e.stdout ?? ""}`;
  }
}

function snapshot() {
  if (win) {
    const ps =
      "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(msedgewebview2|reqseq-shell|node|node-probe|WerFault|WerFaultSecure|WerMgr)\\.exe$' -and [string]$_.CommandLine -notmatch 'drive\\.mjs' } | ForEach-Object { $c = [string]$_.CommandLine; '{0} {1} {2} {3}' -f $_.ProcessId, $_.ParentProcessId, $_.Name, $c.Substring(0, [Math]::Min(200, $c.Length)) }";
    return sh("powershell", ["-NoProfile", "-Command", ps])
      .split(/\r?\n/)
      .filter(Boolean)
      .map(redact);
  }
  let text = sh("ps", ["-axww", "-o", "pid=,ppid=,user=,rgid=,args="]);
  if (text.startsWith("(ps failed")) {
    text = sh("ps", ["-axww", "-o", "pid=,ppid=,user=,args="]);
  }
  return text
    .split("\n")
    .filter((l) => /WebKit|reqseq|bin\.js|ReportCrash|bsexec/.test(l) && !/drive\.mjs|ps -axww/.test(l))
    .map((l) => redact(l.trim().slice(0, 240)));
}

function killAll() {
  if (win) {
    sh("taskkill", ["/T", "/F", "/PID", String(child.pid)]);
    sh("powershell", [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'reqseq-shell.exe' -or ([string]$_.CommandLine -match 'ui --no-open') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
    ]);
  } else {
    child.kill("SIGKILL");
    sh("sudo", ["-n", "pkill", "-9", "-f", "target/debug/reqseq-shell"]);
    sh("sudo", ["-n", "pkill", "-9", "-f", "ui --no-open"]);
  }
}

// The workspace of a session: the fixture of the e2e suite with its element of links, image and raw HTML.
let workspace;
if (o.session) {
  workspace = path.join(process.env.PROBE, `ws-${o.label}`);
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, "fixtures", "SR-004", "one-repository"), workspace, { recursive: true });
  fs.writeFileSync(
    path.join(workspace, "requirements", "SR-6328cee88fb3.md"),
    [
      "---",
      `id: ${ELEMENT}`,
      "type: system-requirement",
      "status: draft",
      "title: Show wind speed",
      "---",
      "",
      "The station shows the current wind speed. See [the guide](https://example.org/guide?from=reqseq), [write to us](mailto:someone@example.org)",
      "and the picture ![wind](https://192.0.2.7/wind.png).",
      "",
      '<a href="https://192.0.2.8/raw">raw link</a> <img src="https://192.0.2.9/raw.png"> <iframe src="https://192.0.2.10/"></iframe>',
      "",
    ].join("\n"),
  );
  if (o.wrap) {
    fs.chmodSync(process.env.PROBE, 0o755);
  }
}

const env = { REQSEQ_SHELL_E2E_NODE: o.node ?? process.execPath, REQSEQ_SHELL_E2E_CLI: CLI, ...(o.env ?? {}) };
let cmd = SHELL;
let args = [];
if (o.wrap) {
  [cmd, ...args] = o.wrap;
  args.push("env", ...Object.entries(env).map(([k, v]) => `${k}=${v}`), SHELL);
}
const t0 = new Date();
const ms = () => Date.now() - t0.getTime();
const child = spawn(cmd, args, { cwd: o.cwd ?? ROOT, env: { ...process.env, ...env }, stdio: "pipe" });
const events = [];
const other = [];
let stderr = "";
let partial = "";
let exit = null;
let spawnError = null;
child.stdout.on("data", (chunk) => {
  partial += chunk.toString("utf8");
  const lines = partial.split("\n");
  partial = lines.pop() ?? "";
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    const m = /^e2e (\S+) (.*)$/.exec(line);
    if (m) {
      let value;
      try {
        value = JSON.parse(m[2]);
      } catch {
        value = m[2];
      }
      events.push({ ms: ms(), kind: m[1], value });
    } else if (other.length < 40) {
      other.push(`${ms()}ms ${line.slice(0, 300)}`);
    }
  }
});
child.stderr.on("data", (c) => {
  stderr += c.toString("utf8");
});
child.stdin.on("error", () => {});
const exited = new Promise((resolve) => {
  child.once("exit", (code, signal) => {
    exit = { code, signal, ms: ms() };
    resolve();
  });
  child.once("error", (e) => {
    spawnError = e.message;
    exit = { error: e.message, ms: ms() };
    resolve();
  });
});

const until = async (f, limit) => {
  const d = Date.now() + limit;
  for (;;) {
    const v = f();
    if (v !== undefined && v !== null && v !== false) return v;
    if (exit || Date.now() > d) return undefined;
    await sleep(50);
  }
};
let nextId = 1;
async function evalJs(script, limit = 5_000) {
  for (let i = 0; i < 3; i++) {
    const id = nextId++;
    child.stdin.write(`${JSON.stringify({ eval: script, id })}\n`);
    const ans = await until(() => events.find((e) => e.kind === "eval" && e.value?.id === id), limit);
    if (ans) return ans.value.result;
    if (exit) return undefined;
  }
  return undefined;
}
async function evalUntil(script, limit = 30_000) {
  const d = Date.now() + limit;
  for (;;) {
    const v = await evalJs(script);
    if (v !== null && v !== false && v !== undefined) return v;
    if (exit || Date.now() > d) return v;
    await sleep(200);
  }
}
const steps = [];
const mark = (s) => steps.push(`${ms()}ms ${s}`);
const snaps = {};

if (o.session) {
  const loaded = await until(
    () => events.find((e) => e.kind === "page-load" && String(e.value).startsWith("Finished")),
    45_000,
  );
  mark(loaded ? "page loaded" : "no page-load");
  if (loaded) {
    await evalUntil("sessionStorage.getItem('reqseq.token') !== null");
    token = Buffer.from(String((await evalJs("btoa(sessionStorage.getItem('reqseq.token') || '')")) ?? ""), "base64").toString("utf8") || null;
    if (token) fs.writeFileSync(path.join(PRIV, `token-${o.label}`), token);
    mark(`token ${token ? `typeof ${typeof token} length ${String(token).length} shape ${JSON.stringify(token).replace(/[A-Za-z0-9]/g, "x")}` : "missing"}`);
    if (typeof token !== "string" || token.length < 20) token = null;
    await evalJs(`(() => {
      window.__opened = null;
      fetch("ui/workspace", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + sessionStorage.getItem("reqseq.token") },
        body: ${JSON.stringify(JSON.stringify({ path: workspace }))},
      }).then(async (r) => { window.__generation = (await r.json()).generation; window.__opened = r.status; }, (e) => { window.__opened = String(e); });
      return true;
    })()`);
    mark(`workspace open ${JSON.stringify(await evalUntil("window.__opened"))}`);
    const route = `#/e/${ELEMENT}`;
    const shown = await evalUntil(
      `(() => { if (location.hash !== ${JSON.stringify(route)}) { location.hash = ${JSON.stringify(route)}; return false; } return document.readyState === "complete"; })()`,
    );
    mark(`element route ${String(shown)}`);
    const link = await evalUntil(`document.querySelector('a[href^="https://example.org/guide"]') !== null`, 15_000);
    mark(`element shown ${String(link)}`);
    await sleep(3_000);
    snaps.showing = snapshot();
    child.stdin.write(`${JSON.stringify({ close: true })}\n`);
    mark("close sent");
    await Promise.race([exited, sleep(15_000)]);
  }
} else {
  await Promise.race([exited, sleep(Math.min(20_000, cap))]);
  if (!exit) snaps.at20s = snapshot();
}
await Promise.race([exited, sleep(Math.max(0, cap - ms()))]);
const timedOut = !exit;
if (timedOut) {
  snaps.atCap = snapshot();
  mark("cap reached: killing");
  killAll();
  await Promise.race([exited, sleep(5_000)]);
}
await sleep(1_500);
snaps.after = snapshot();
killAll();

const result = {
  label: o.label,
  platform: process.platform,
  command: [cmd, ...args].join(" "),
  t0: t0.toISOString(),
  t1: new Date().toISOString(),
  childPid: child.pid,
  exit: timedOut ? `no exit within ${cap} ms (killed)` : exit,
  spawnError,
  steps,
  driverLines: events
    .filter((e) => e.kind !== "eval")
    .map((e) => `${e.ms}ms ${e.kind} ${redact(JSON.stringify(e.value)).slice(0, 300)}`),
  evalAnswers: events.filter((e) => e.kind === "eval").length,
  otherStdout: other.map(redact),
  stderr: redact(stderr).slice(-3_000),
  reasonLine: /ReqSeq: the window could not open: /.test(stderr),
  panicHookLine: /^ReqSeq: the window could not open\.\s*$/m.test(stderr),
  tokenInStderrOrStdout: token !== null && (stderr.includes(token) || other.some((l) => l.includes(token))),
  workspace,
  snapshots: snaps,
};
const text = JSON.stringify(result, null, 2);
console.log(`PROBE-RESULT ${o.label}`);
console.log(text);
fs.writeFileSync(path.join(OUT, `${o.label}.json`), text);
process.exit(0);
