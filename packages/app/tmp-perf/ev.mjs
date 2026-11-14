import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Session } from "node:inspector/promises";
import { Workspace, invoke, versionIn, NORMAL_FORM, warmWorkspace } from "@reqseq/core";
import { createFixtureWorkspace, defaultStandardModelFile, generateLargeWorkspace, writeLargeWorkspace, withEvidenceRecords } from "@reqseq/testkit";
const state = "/tmp/claude-0/ev.json";
let root, top, cache;
if (!fs.existsSync(state)) {
  const fixture = await createFixtureWorkspace({ files: {
    "reqseq-workspace.yaml": 'reqseq-workspace: 1\nname: Model\nrepositories:\n  - { name: system, url: "x" }\nmetamodel: { repository: system, path: metamodel }\n',
    "metamodel/standard-model.yaml": fs.readFileSync(defaultStandardModelFile, "utf8") } });
  const w = new Workspace(fixture.root); const metamodel = await invoke("metamodel.get", {}, { workspace: w }); await w.close();
  const version = ({ type, text, properties }) => { const keys = new Set(metamodel.types.find((t) => t.key === type)?.properties ?? []);
    return versionIn({ text, properties, definitions: metamodel.properties.filter((p) => keys.has(p.key)).map((p) => ({ key: p.key, kind: p.kind, ...(p.content === undefined ? {} : { content: p.content }) })), files: [] }, NORMAL_FORM); };
  const evidence = withEvidenceRecords(generateLargeWorkspace({ version, elements: 50000, relations: 200000 }));
  const fx = await writeLargeWorkspace(evidence.workspace);
  cache = fs.mkdtempSync(path.join(os.tmpdir(), "ev-cache-"));
  fs.writeFileSync(state, JSON.stringify({ root: fx.workspaceRoot, top: evidence.parents[0], cache }));
  await new Promise((r) => setTimeout(r, 2500));
  const ws = new Workspace(fx.workspaceRoot, { cacheFolder: cache }); await warmWorkspace(ws); await ws.close();
  console.log("generated"); process.exit(0);
}
({ root, top, cache } = JSON.parse(fs.readFileSync(state, "utf8")));
const ws = new Workspace(root, { cacheFolder: cache });
await warmWorkspace(ws);
const { evidenceIndexState } = await import("../../core/dist/evidence/index.js");
await ws.get(evidenceIndexState);
const ctx = { workspace: ws };
const open = () => Promise.all([invoke("element.get", { ref: top }, ctx), invoke("trace.neighbourhood", { ref: top, direction: "up", meanings: ["derivation"], allLevels: true, limit: 200 }, ctx)]);
const prof = process.argv[2] === "prof";
let s; if (prof) { s = new Session(); s.connect(); await s.post("Profiler.enable"); await s.post("Profiler.setSamplingInterval", { interval: 200 }); await s.post("Profiler.start"); }
const fsm = (await import("node:fs")).default; let n = 0; const orig = fsm.lstatSync; fsm.lstatSync = (...a) => { n++; return orig(...a); };
let t = performance.now(); await open(); console.log("lstats", n); const first = performance.now() - t;
if (prof) { const { profile } = await s.post("Profiler.stop"); fs.writeFileSync("/tmp/claude-0/ev.cpuprofile", JSON.stringify(profile)); }
t = performance.now(); await open(); console.log({ first, again: performance.now() - t });
await ws.close();
