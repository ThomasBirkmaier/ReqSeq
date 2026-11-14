import fs from "node:fs";
import path from "node:path";
import { Workspace, invoke, cacheFolder, warmWorkspace, watchWorkspace } from "@reqseq/core";
const { root, reqs } = JSON.parse(fs.readFileSync("/tmp/claude-0/ws.json", "utf8"));
const ws = new Workspace(root, { cacheFolder: cacheFolder(root) });
const watcher = watchWorkspace(ws); await watcher.ready;
await warmWorkspace(ws);
const ctx = { workspace: ws, access: "app" };
const open = (id) => Promise.all([invoke("element.get", { ref: id }, ctx), invoke("trace.neighbourhood", { ref: id, direction: "up", meanings: ["derivation"], allLevels: true, limit: 200 }, ctx), invoke("evidence.list", { ref: id }, ctx)]);
const [A, B, ...rest] = reqs;
await open(B.id); await open(A.id);
const a = await invoke("element.get", { ref: A.id }, ctx);
const file = path.join(root, "..", a.element.repository === "system" ? "system" : a.element.repository, a.element.file);
const abs = fs.existsSync(file) ? file : path.join(root, a.element.file);
console.log("file", abs, fs.existsSync(abs));
let round = 0;
for (const delay of [0, 50, 150, 300, 500, 800, 1200, 0, 100, 400]) {
  const t0 = performance.now();
  fs.appendFileSync(abs, `\nChanged ${round++}.\n`);
  await new Promise((r) => setTimeout(r, delay));
  const target = rest[round % rest.length];
  const t1 = performance.now();
  await open(target.id);
  console.log(`delay ${delay}: open ${(performance.now() - t1).toFixed(0)} ms`);
  await new Promise((r) => setTimeout(r, 2500));
}
await watcher.close?.(); await ws.close();
