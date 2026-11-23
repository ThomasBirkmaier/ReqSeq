// Probe #2465 (macOS, second eslogger probe): for each eslogger stream given, counts events per type, gaps in
// global_seq_num and seq_num per type, the time span, and whether the shell, the controls and WebKit processes appear.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const P = process.env.PROBE;
const read = (f, d = "") => {
  try {
    return fs.readFileSync(f, "utf8");
  } catch {
    return d;
  }
};
const priv = path.join(P, "private");
const tokens = fs
  .readdirSync(priv)
  .filter((f) => f.startsWith("token-"))
  .map((f) => read(path.join(priv, f)).trim())
  .filter(Boolean);
const ctl = Object.fromEntries(
  fs
    .readdirSync(priv)
    .filter((f) => f.startsWith("pid-"))
    .map((f) => [Number(read(path.join(priv, f))), f.slice(4)]),
);
console.log(`tokens: ${tokens.length}; controls ${JSON.stringify(ctl)}`);
console.log(`marks:\n${read(path.join(priv, "marks.txt"))}`);
for (const file of process.argv.slice(2)) {
  if (!fs.existsSync(file)) {
    console.log(`${file}: missing`);
    continue;
  }
  const kinds = new Map();
  const perType = new Map();
  const seqs = [];
  let first;
  let last;
  let lines = 0;
  let bad = 0;
  const execs = [];
  const webkit = new Map();
  const tokenHits = new Map();
  const byExe = new Map();
  const wsEvents = new Map();
  const sample = {};
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }) });
  for await (const line of rl) {
    lines++;
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      bad++;
      continue;
    }
    const kind = Object.keys(m.event ?? {})[0] ?? `type ${m.event_type}`;
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    sample[kind] ??= line.slice(0, 1500);
    if (typeof m.global_seq_num === "number") seqs.push(m.global_seq_num);
    if (typeof m.seq_num === "number") {
      const a = perType.get(kind) ?? [];
      a.push(m.seq_num);
      perType.set(kind, a);
    }
    first ??= m.time;
    last = m.time;
    for (const t of tokens) if (line.includes(t)) tokenHits.set(kind, (tokenHits.get(kind) ?? 0) + 1);
    const p = m.process ?? {};
    const exe = p.executable?.path ?? "?";
    const short = exe
      .replace(/^\/Users\/runner\/work\/ReqSeq\/ReqSeq\//, "")
      .replace(/\/Users\/runner\/hostedtoolcache\/node\/[^/]+\/[^/]+\//, "NODE/");
    byExe.set(short, (byExe.get(short) ?? 0) + 1);
    const ev = m.event?.[kind] ?? {};
    if (kind === "exec") {
      const t = ev.target ?? {};
      execs.push({
        pid: t.audit_token?.pid,
        ppid: t.ppid,
        rpid: t.responsible_audit_token?.pid,
        path: t.executable?.path,
        time: m.time,
        args: (ev.args ?? []).slice(0, 4).join(" ").slice(0, 160),
        signing: t.signing_id,
        egid: t.audit_token?.egid,
      });
    }
    if (/com\.apple\.WebKit\./.test(exe) && p.audit_token && !webkit.has(p.audit_token.pid)) {
      webkit.set(p.audit_token.pid, {
        exe: path.basename(exe),
        ppid: p.ppid,
        rpid: p.responsible_audit_token?.pid,
        start: p.start_time,
        signing: p.signing_id,
        egid: p.audit_token.egid,
      });
    }
    const fp =
      ev.file?.path ??
      ev.target?.path ??
      ev.source?.path ??
      ev.destination?.existing_file?.path ??
      (ev.destination?.new_path ? `${ev.destination.new_path.dir?.path}/${ev.destination.new_path.filename}` : "");
    if (typeof fp === "string" && /\/ws-/.test(fp)) {
      const k = `${kind} ${p.audit_token?.pid} ${short}`;
      wsEvents.set(k, (wsEvents.get(k) ?? 0) + 1);
    }
  }
  seqs.sort((a, b) => a - b);
  let gaps = 0;
  for (let i = 1; i < seqs.length; i++) gaps += seqs[i] - seqs[i - 1] - 1;
  console.log(`\n=== ${path.basename(file)}: ${lines} lines (${bad} bad), ${fs.statSync(file).size} bytes, ${first} .. ${last}`);
  console.log(`events ${JSON.stringify(Object.fromEntries(kinds))}`);
  console.log(`global_seq_num ${seqs[0]}..${seqs.at(-1)}: ${seqs.length} seen, missing ${gaps}`);
  for (const [k, a] of perType) {
    a.sort((x, y) => x - y);
    let g = 0;
    for (let i = 1; i < a.length; i++) g += a[i] - a[i - 1] - 1;
    console.log(`  seq_num ${k}: ${a[0]}..${a.at(-1)}, missing ${g}`);
  }
  console.log(`token hits ${JSON.stringify(Object.fromEntries(tokenHits))}`);
  const shells = execs.filter((e) => /reqseq-shell$/.test(e.path ?? ""));
  console.log(`shell execs: ${JSON.stringify(shells)}`);
  console.log(`control execs: ${JSON.stringify(execs.filter((e) => ctl[e.pid]))}`);
  for (const s of shells) {
    console.log(`  execs with ppid or rpid = shell ${s.pid}: ${JSON.stringify(execs.filter((e) => e.ppid === s.pid || e.rpid === s.pid))}`);
  }
  console.log(`WebKit processes: ${JSON.stringify([...webkit].map(([pid, i]) => ({ pid, ...i })))}`);
  console.log(`WebKit execs: ${JSON.stringify(execs.filter((e) => /WebKit/.test(e.path ?? "")))}`);
  console.log(`workspace file events: ${JSON.stringify(Object.fromEntries(wsEvents))}`);
  console.log("events by executable (top 20):");
  for (const [k, c] of [...byExe].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${c} ${k}`);
  console.log("one sample per type:");
  for (const [k, v] of Object.entries(sample)) console.log(`  ${k}: ${tokens.reduce((t, x) => t.split(x).join("<T>"), v)}`);
}
