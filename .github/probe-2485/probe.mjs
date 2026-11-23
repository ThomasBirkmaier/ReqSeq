// Temporary probe for #2485 (removed before the PR is ready): times the stages of shell starts on a fresh runner.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const SHELL = path.join(root, "packages", "shell", "target", "debug", "reqseq-shell.exe");
const CLI = path.join(root, "packages", "cli", "dist", "bin.js");

function ps(command) {
  try {
    return execFileSync("pwsh", ["-NoProfile", "-Command", command], { encoding: "utf8", timeout: 60_000 }).trim();
  } catch (e) {
    return `error: ${String(e)}`;
  }
}

function start(name, program) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const marks = [];
    const env = { ...process.env, REQSEQ_SHELL_E2E_NODE: process.execPath, REQSEQ_SHELL_E2E_CLI: CLI };
    const child = spawn(program, [], { cwd: root, env, stdio: "pipe" });
    let out = "";
    let err = "";
    let closed = false;
    let snapshot = null;
    child.stdout.on("data", (c) => {
      out += c.toString();
      for (const line of out.split("\n").slice(0, -1)) {
        if (line.startsWith("e2e ") && !marks.some((m) => m.line === line.slice(0, 100))) {
          marks.push({ ms: Date.now() - t0, line: line.slice(0, 100) });
          if (line.startsWith("e2e page-load") && line.includes("Finished") && !closed) {
            closed = true;
            child.stdin.write(`${JSON.stringify({ close: true })}\n`);
          }
        }
      }
    });
    child.stderr.on("data", (c) => (err += c.toString()));
    const slow = setTimeout(() => {
      snapshot = ps(
        "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'msedgewebview2|node|reqseq|MsMpEng|edgeupdate|MicrosoftEdgeUpdate|TiWorker|WerFault' } | Select-Object ProcessId,ParentProcessId,Name | Format-Table -AutoSize | Out-String -Width 200",
      );
    }, 20_000);
    const cap = setTimeout(() => child.kill(), 120_000);
    child.once("exit", (code) => {
      clearTimeout(slow);
      clearTimeout(cap);
      resolve({ name, total: Date.now() - t0, code, marks, stderr: err.slice(-500), snapshot });
    });
  });
}

const results = { host: { cpus: os.cpus().length, mem: Math.round(os.totalmem() / 1024 ** 3) } };
results.defender = ps(
  "Get-MpComputerStatus | Select-Object AMRunningMode,RealTimeProtectionEnabled,OnAccessProtectionEnabled,IoavProtectionEnabled,BehaviorMonitorEnabled | ConvertTo-Json -Compress",
);
results.defenderPrefs = ps(
  "Get-MpPreference | Select-Object DisableRealtimeMonitoring,ExclusionPath,ExclusionProcess | ConvertTo-Json -Compress",
);
results.webview2 = ps(
  "Get-ChildItem 'C:\\Program Files (x86)\\Microsoft\\EdgeWebView\\Application' -Directory | Select-Object Name,CreationTimeUtc | ConvertTo-Json -Compress",
);
results.boot = ps("(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')");
results.now = new Date().toISOString();
results.shellMtime = fs.statSync(SHELL).mtime.toISOString();
results.shellSize = fs.statSync(SHELL).size;
results.runs = [];
results.runs.push(await start("cold 1", SHELL));
results.runs.push(await start("warm 2", SHELL));
results.runs.push(await start("warm 3", SHELL));
const copyD = path.join(path.dirname(SHELL), "reqseq-shell-copy.exe");
fs.copyFileSync(SHELL, copyD);
results.runs.push(await start("new copy on D", copyD));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "probe-"));
const copyC = path.join(tmp, "reqseq-shell.exe");
fs.copyFileSync(SHELL, copyC);
results.runs.push(await start("new copy in TEMP", copyC));
results.runs.push(await start("warm 4", SHELL));
const nodeCopy = path.join(tmp, "node-copy.exe");
fs.copyFileSync(process.execPath, nodeCopy);
for (const n of ["node copy first", "node copy second"]) {
  const t = Date.now();
  execFileSync(nodeCopy, ["-e", "0"]);
  results.runs.push({ name: n, total: Date.now() - t });
}
console.log(JSON.stringify(results, null, 1));
