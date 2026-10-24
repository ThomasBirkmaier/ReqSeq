#!/usr/bin/env python3
# Creates stage epics and one issue per SR (sr-issues skill). Idempotent via body markers.
import json, subprocess, hashlib, re, os, sys, time
REPO = "repos/ThomasBirkmaier/logreq"
SPEC = sys.argv[1]
DRY = "--dry" in sys.argv

def api(path, method="GET", data=None):
    cmd = ["gh", "api", "-X", method, f"{REPO}/{path}" if not path.startswith("/") else path]
    if data is not None:
        cmd += ["--input", "-"]
    r = subprocess.run(cmd, input=json.dumps(data) if data is not None else None, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"{method} {path}: {r.stdout} {r.stderr}")
    return json.loads(r.stdout) if r.stdout.strip() else None

def all_issues():
    out, page = [], 1
    while True:
        b = api(f"issues?state=all&per_page=100&page={page}")
        out += [i for i in b if "pull_request" not in i]
        if len(b) < 100: return out
        page += 1

def parse(f):
    t = open(f, encoding="utf8").read()
    _, fm, body = t.split("---\n", 2)
    meta, cur = {}, None
    for line in fm.splitlines():
        m = re.match(r"^([a-z_]+):(?: (.*))?$", line)
        if m:
            cur = m.group(1)
            meta[cur] = json.loads(m.group(2)) if m.group(2) else []
        elif line.startswith("  - "):
            meta[cur].append(json.loads(line[4:]))
    return meta, body.strip(), hashlib.sha256(t.encode()).hexdigest()

stages = json.load(open(os.path.join(SPEC, "stages.json")))
stage_of = {sr: k for k, v in stages.items() for sr in v}
D035 = {
 "1": "Fundament", "2": "Traceability", "3": "Oberfläche", "4": "Nachweise",
 "5": "Pakete, Baselines und Varianten", "6": "Austausch per ReqIF und Schutz"}
SCOPE = {
 "1": "Dateiformat nach D-015 und D-038, IDs, Standardmodell, Status, Fassung, ein oder viele Repositories, Programmlogik mit Kommandozeile und API",
 "2": "Beziehungen, Kette, veraltete Verweise, betroffene Elemente, Prüfung im Merge Request",
 "3": "Editor, Verlinken, Suche, Filter",
 "4": "Nachweis-Datensätze, Abdeckung, indirekter Nachweis, Validierung",
 "5": "Pakete, Baselines und Varianten",
 "6": "Austausch per ReqIF und Schutz (Vertrauliches getrennt, Metamodell schützen)"}

issues = all_issues()
def find(marker):
    return next((i for i in issues if marker in (i.get("body") or "")), None)

created = updated = 0
epics = {}
for n in list(D035) + ["querschnitt"]:
    marker = f"<!-- epic:stage-{n} -->"
    if n == "querschnitt":
        title = "Cross-cutting: requirements for every stage"
        labels = ["querschnitt"]
        text = ("Cross-cutting system requirements apply to every function (all accesses, offline, local only, English UI, Git read-only, stable files, selection). "
                "Every stage checks them. They stay open across all stages and close at the end of stage 6.")
    else:
        title = f"Stage {n}: {D035[n]}"
        labels = [f"stage:{n}"]
        text = f"Scope after D-035: \"{SCOPE[n]}\".\n\nStage acceptance (D-035, D-050): all SRs of the stage closed, `pnpm trace-check --stage {n}` green, cross-cutting SRs checked, verification records in `verification/` confirmed by Thomas."
        if n == "1":
            text += "\n\nN-036 (50,000 requirements) is the performance benchmark from stage 1 on (D-035)."
        if n == "3":
            text += ("\n\n**UI acceptance gate (N-032).** Thomas personally accepts the look and feel of the app before stage 3 closes. "
                     "N-032: \"Das Tool muss im täglichen Gebrauch einfach und minimalistisch sein und ästhetisch überzeugen, schon beim ersten Eindruck. Maßstab ist Logseq.\" "
                     "There is no SR for this; agents prepare screenshots and a short demo and label the epic `needs-human`. Agents never mark it as accepted.")
    body = f"{marker}\n{text}\n\nSub-issues: the SR issues of this group."
    e = find(marker)
    if DRY:
        epics[n] = {"number": 0, "id": 0}; continue
    if not e:
        e = api("issues", "POST", {"title": title, "body": body, "labels": labels, "assignees": ["ThomasBirkmaier"]}); created += 1; time.sleep(1)
    epics[n] = e

for f in sorted(os.listdir(os.path.join(SPEC, "system-requirements"))):
    meta, text, h = parse(os.path.join(SPEC, "system-requirements", f))
    sr = meta["id"]
    st = stage_of[sr]
    thema = meta["thema"]
    slug = re.sub(r"[^a-z0-9äöüß]+", "-", thema.lower()).strip("-")
    aks = "\n".join(f"- [ ] AK{i}: {a}" for i, a in enumerate(meta.get("akzeptanzkriterien", []), 1))
    stage_txt = "Querschnitt (all stages)" if st == "querschnitt" else f"Stage {st}"
    rel = []
    if meta.get("derives_from"): rel.append("Derives from: " + ", ".join(meta["derives_from"]))
    if meta.get("based_on"): rel.append("Based on: " + ", ".join(meta["based_on"]))
    head = (f"<!-- sr:{sr} -->\n**{sr}** · UUID `{meta['uuid']}` · {stage_txt} · Thema {thema} · Nachweismethode {meta.get('nachweismethode','')}\n"
            + (" · ".join(rel) + "\n" if rel else "")
            + f"\n{text}\n\n**Akzeptanzkriterien**\n{aks}\n\nSpec: `spec/system-requirements/{sr}.md`\n\n<!-- spec-hash:{h} -->\n")
    labels = ["sr", f"thema:{slug}"] + (["querschnitt"] if st == "querschnitt" else [f"stage:{st}"])
    title = f"{sr} {meta['title']}"
    i = find(f"<!-- sr:{sr} -->")
    if DRY:
        print(title, labels); print(head + "<!-- deps:start --><!-- deps:end -->") if sr == "SR-036" else None; continue
    if not i:
        i = api("issues", "POST", {"title": title, "body": head + "<!-- deps:start --><!-- deps:end -->", "labels": labels, "assignees": ["ThomasBirkmaier"]})
        created += 1
        api(f"issues/{epics[st]['number']}/sub_issues", "POST", {"sub_issue_id": i["id"]})
        time.sleep(1.5)
    else:
        old = i["body"] or ""
        tail = old[old.index("<!-- deps:start -->"):] if "<!-- deps:start -->" in old else "<!-- deps:start --><!-- deps:end -->"
        if head + tail != old or i["title"] != title:
            patch = {"title": title, "body": head + tail, "labels": labels}
            if i["state"] == "closed" and f"spec-hash:{h}" not in old:
                patch["state"] = "open"; patch["labels"] = labels + ["spec-geändert"]
            api(f"issues/{i['number']}", "PATCH", patch); updated += 1; time.sleep(1)
    print(sr, i["number"], flush=True)
print(f"created {created}, updated {updated}")
