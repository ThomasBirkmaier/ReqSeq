#!/usr/bin/env python3
# Creates stage epics and one issue per SR (spec-change skill). Idempotent via body markers.
import json, subprocess, hashlib, re, os, sys, time
REPO = "repos/ThomasBirkmaier/ReqSeq"
SPEC = sys.argv[1] if __name__ == "__main__" else "spec"
DRY = "--dry" in sys.argv
# Only writes the property `issue` of each SR from the issues found, nothing on GitHub (#183).
FILL = "--fill-issue" in sys.argv

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

# The spec is the ReqSeq workspace in spec/ (D-064, #326). It is read with ReqSeq itself (`pnpm build` first),
# so this script sees exactly what every other access sees.
REQSEQ = [os.environ.get("NODE", "node"), os.path.join(os.path.dirname(__file__), "..", "..", "packages", "cli", "dist", "bin.js")]
METHOD = {"test": "Test", "inspection": "Inspektion", "demonstration": "Demonstration", "analysis": "Analyse"}
LINK = re.compile(r"\[([^\]\n]*)\]\(reqseq:[^)\n]*\)")

def reqseq(*args):
    r = subprocess.run(REQSEQ + list(args) + ["--workspace", SPEC, "--json"], capture_output=True, text=True, encoding="utf8")
    if r.returncode:
        raise SystemExit(f"reqseq {' '.join(args)}: {r.stdout} {r.stderr}")
    return json.loads(r.stdout)

def system_requirements():
    query = {"selection": {"where": {"type": ["system-requirement"]}}, "sort": [{"by": "spec-id"}], "withText": True, "limit": 5000}
    out = reqseq("element", "list", "--input", json.dumps(query))
    if out.get("incomplete"):
        raise SystemExit("the spec workspace is incomplete")
    return out["elements"]

def stage_of(e):
    """Stage key ("3", "querschnitt", "v0.9") from the package the SR names (identifier Stufe-3, Querschnitt, v0.9), or None."""
    ids = [r.get("identifier", "") for r in e["relations"] if r["kind"] == "packages" and r["direction"] == "out"]
    if len(ids) != 1 or ids[0] == "":
        return None
    return ids[0][len("Stufe-"):] if ids[0].startswith("Stufe-") else ids[0].lower()

# Wishes parked during a stage (package Später, product owner decision, 2026-10-27): no stage yet,
# so no issue from this script.
PARKED = "später"

# From v0.9 on, new SRs go into a package named like their milestone (product owner decision, 2026-11-02):
# the issue gets that GitHub milestone, no stage label, and hangs under a lane epic (#595).
MILESTONE = re.compile(r"^v\d+\.\d+$")

def is_milestone(st):
    return st is not None and MILESTONE.match(st) is not None

# The lane epic (its body marker <!-- epic:lane-... -->) of an SR in a milestone package, by its topic.
# Lanes cut across topics, so no rule derives one from the other. "Betrieb und Leistung" mixes performance,
# security, docs and accesses and has no row: an SR with a topic missing here stops the run until a row is added.
LANE = {
 "Ablage und Repositories": "lane-data", "Import und Export": "lane-data", "Metamodell und Typen": "lane-data",
 "Nachweis und Abdeckung": "lane-data", "Pakete und Baselines": "lane-data", "Traceability und Ketten": "lane-data",
 "Varianten": "lane-data", "Bearbeiten und Finden": "lane-app", "Anbindung und Auswertung": "lane-cli"}

def milestone_number(milestones, key):
    """The number of the one GitHub milestone titled `key` or `key` plus a name (v0.9 Own use and simplicity), or None."""
    found = [m["number"] for m in milestones if m["title"] == key or m["title"].startswith(key + " ")]
    return found[0] if len(found) == 1 else None

def placement(st):
    """The stage text of the issue head and the labels from the package, without sr and thema."""
    if st == "querschnitt":
        return "Querschnitt (all stages)", ["querschnitt"]
    if is_milestone(st):
        return f"Milestone {st}", []
    return f"Stage {st}", [f"stage:{st}"]

def invalid_statuses():
    """Status keys the metamodel of the spec marks invalid (D-044), e.g. obsolete."""
    return {st["key"] for st in reqseq("metamodel", "get")["statuses"] if st.get("invalid")}

def validate(srs, stages):
    """Every problem that would stop the run, found before the first write: identifier, stage, topic."""
    problems = []
    for e in srs:
        sr = e.get("identifier") or e["shortId"]
        if not e.get("identifier"):
            problems.append(f"{sr}: no spec-id")
        st = stage_of(e)
        if st is None:
            problems.append(f"{sr}: needs exactly one stage package")
        elif st == PARKED:
            pass
        elif is_milestone(st):
            topic = e["properties"].get("topic")
            if topic and topic not in LANE:
                problems.append(f"{sr}: topic {topic} has no lane epic (LANE in sr_issues.py)")
        elif st not in stages:
            problems.append(f"{sr}: package {st} is no stage ({', '.join(stages)}) or milestone (v<major>.<minor>)")
        if not e["properties"].get("topic"):
            problems.append(f"{sr}: no topic")
    return problems

def is_managed(label):
    """The labels this script sets from the spec; every other label of an issue is kept."""
    return label in ("sr", "querschnitt") or label.startswith("stage:") or label.startswith("thema:")

def merged_labels(existing, managed, extra=()):
    """The labels to PATCH: the managed ones from the spec, then every other label the issue has
    (blocked, agent:working, needs-human, ...), then `extra` (spec-geändert). PATCH replaces the set."""
    out = list(managed)
    for label in list(existing) + list(extra):
        if not is_managed(label) and label not in out:
            out.append(label)
    return out

def quoted_changed(old, head, h):
    """Whether the quoted spec part of an issue body changed. Issues written before the migration (#326)
    carry `spec-hash` over a file of the old export, which no longer exists: for them the part above the
    Spec line is compared."""
    if "<!-- spec-content:" in old:
        return f"spec-content:{h}" not in old
    quoted = lambda t: t.split("\n\nSpec: `", 1)[0]
    return quoted(old) != quoted(head)

def content_hash(e, text):
    """What the issue quotes; a change of it reopens a closed issue. Link versions are left out (#281)."""
    p = e["properties"]
    data = {"text": text, "aks": p.get("acceptance-criteria", []), "method": p.get("verification-method"), "type": p.get("requirement-type")}
    return hashlib.sha256(json.dumps(data, ensure_ascii=False, sort_keys=True).encode()).hexdigest()

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

def issue_update(e, issue):
    """The element.update input that writes the URL of the SR's issue into its property `issue` (D-049,
    #183), or None when it holds that URL already. `issue` is no content, so this changes no version,
    and content_hash leaves it out, so no issue body changes."""
    url = issue["html_url"]
    return None if e["properties"].get("issue") == url else {"set": {"issue": url}}

def fill_issue(e, issue):
    """Writes the property `issue` of the SR with ReqSeq when it is missing or different; True if it wrote."""
    update = issue_update(e, issue)
    if update is None:
        return False
    reqseq("element", "update", e["id"], "--input", json.dumps(update))
    return True

def main():
    srs = system_requirements()
    invalid = invalid_statuses()
    problems = validate([e for e in srs if e.get("status") not in invalid], list(D035) + ["querschnitt"])
    if problems:
        raise SystemExit("nothing written; fix the spec first:\n  " + "\n  ".join(problems))
    issues = all_issues()
    def find(marker):
        return next((i for i in issues if marker in (i.get("body") or "")), None)

    # Milestones and lane epics of the milestone packages, all found before the first write.
    placed = [e for e in srs if e.get("status") not in invalid and is_milestone(stage_of(e))]
    gh_milestones = api("milestones?state=all&per_page=100") if placed else []
    milestones, lanes, missing = {}, {}, []
    for e in placed:
        st, lane = stage_of(e), LANE[e["properties"]["topic"]]
        milestones[st] = milestone_number(gh_milestones, st)
        lanes[lane] = find(f"<!-- epic:{lane} -->")
    missing += [f"package {st}: no single GitHub milestone titled {st}" for st, m in milestones.items() if m is None]
    missing += [f"no epic with <!-- epic:{lane} -->" for lane, i in lanes.items() if i is None]
    if missing:
        raise SystemExit("nothing written:\n  " + "\n  ".join(missing))

    created = updated = filled = 0
    epics = {}
    for n in list(D035) + ["querschnitt"]:
        marker = f"<!-- epic:stage-{n} -->"
        if n == "querschnitt":
            title = "Cross-cutting: requirements for every stage"
            labels = ["querschnitt", "epic"]
            text = ("Cross-cutting system requirements apply to every function (all accesses, offline, local only, English UI, Git read-only, stable files, selection). "
                    "Every stage checks them. They stay open across all stages and close with milestone v0.8 Consolidation.")
        else:
            title = f"Stage {n}: {D035[n]}"
            labels = [f"stage:{n}", "epic"]
            text = f"Scope after D-035: \"{SCOPE[n]}\".\n\nStage acceptance (D-035, D-050): all SRs of the stage closed, `pnpm trace-check --stage {n}` green, cross-cutting SRs checked, verification records in `verification/` confirmed by the product owner."
            if n == "1":
                text += "\n\nN-036 (50,000 requirements) is the performance benchmark from stage 1 on (D-035)."
            if n == "3":
                text += ("\n\n**UI acceptance gate (N-032).** The product owner personally accepts the look and feel of the app before stage 3 closes. "
                         "N-032: \"Das Tool muss im täglichen Gebrauch einfach und minimalistisch sein und ästhetisch überzeugen, schon beim ersten Eindruck. Maßstab ist Logseq.\" "
                         "There is no SR for this; agents prepare screenshots and a short demo and label the epic `needs-human`. Agents never mark it as accepted.")
        body = f"{marker}\n{text}\n\nSub-issues: the SR issues of this group."
        e = find(marker)
        if DRY or FILL:
            epics[n] = {"number": 0, "id": 0}; continue
        if not e:
            e = api("issues", "POST", {"title": title, "body": body, "labels": labels, "assignees": ["ThomasBirkmaier"]}); created += 1; time.sleep(1)
        epics[n] = e

    for e in srs:
        sr = e["identifier"]
        if e.get("status") in invalid:
            print(sr, f"{e['status']}, skipped (close its open issue by hand)", flush=True)
            continue
        p = e["properties"]
        st = stage_of(e)
        if st == PARKED:
            print(sr, "parked in Später, skipped (planned at the next stage boundary)", flush=True)
            continue
        thema = p["topic"]
        text = LINK.sub(r"\1", e.get("text", "")).strip()
        h = content_hash(e, text)
        slug = re.sub(r"[^a-z0-9äöüß]+", "-", thema.lower()).strip("-")
        aks = "\n".join(f"- [ ] AK{i}: {a}" for i, a in enumerate(p.get("acceptance-criteria", []), 1))
        stage_txt, placed_labels = placement(st)
        rel = []
        targets = lambda kind: ", ".join(r.get("identifier", r["shortId"]) for r in e["relations"] if r["kind"] == kind and r["direction"] == "out")
        if targets("derives-from"): rel.append("Derives from: " + targets("derives-from"))
        if targets("based-on"): rel.append("Based on: " + targets("based-on"))
        head = (f"<!-- sr:{sr} -->\n**{sr}** · UUID `{e['id']}` · {stage_txt} · Thema {thema} · Nachweismethode {METHOD.get(p.get('verification-method'), p.get('verification-method', ''))}\n"
                + (" · ".join(rel) + "\n" if rel else "")
                + f"\n{text}\n\n**Akzeptanzkriterien**\n{aks}\n\nSpec: `spec/{e['file']}` (`reqseq element get {sr} --workspace spec`)\n\n<!-- spec-content:{h} -->\n")
        labels = ["sr", f"thema:{slug}"] + placed_labels
        title = f"{sr} {e['title']}"
        # A milestone package sets the milestone and the lane epic; P1-P3 stays with the lead (lead-run).
        milestone = milestones.get(st)
        epic = lanes[LANE[thema]] if milestone else epics[st]
        i = find(f"<!-- sr:{sr} -->")
        if FILL:
            if i is not None and fill_issue(e, i):
                filled += 1
            continue
        if DRY:
            print(title, labels, *([f"milestone {st} (#{milestone})", f"epic #{epic['number']}"] if milestone else []))
            print(head + "<!-- deps:start --><!-- deps:end -->") if sr == "SR-036" else None
            continue
        if not i:
            post = {"title": title, "body": head + "<!-- deps:start --><!-- deps:end -->", "labels": labels, "assignees": ["ThomasBirkmaier"]}
            if milestone:
                post["milestone"] = milestone
            i = api("issues", "POST", post)
            created += 1
            api(f"issues/{epic['number']}/sub_issues", "POST", {"sub_issue_id": i["id"]})
            time.sleep(1.5)
        else:
            old = i["body"] or ""
            tail = old[old.index("<!-- deps:start -->"):] if "<!-- deps:start -->" in old else "<!-- deps:start --><!-- deps:end -->"
            moved = milestone is not None and (i.get("milestone") or {}).get("number") != milestone
            if head + tail != old or i["title"] != title or moved:
                existing = [label["name"] for label in i.get("labels", [])]
                reopen = i["state"] == "closed" and quoted_changed(old, head, h)
                patch = {"title": title, "body": head + tail, "labels": merged_labels(existing, labels, ["spec-geändert"] if reopen else [])}
                if milestone:
                    patch["milestone"] = milestone
                if reopen:
                    patch["state"] = "open"
                api(f"issues/{i['number']}", "PATCH", patch); updated += 1; time.sleep(1)
        if fill_issue(e, i):
            filled += 1
        print(sr, i["number"], flush=True)
    print(f"created {created}, updated {updated}, issue property written {filled}")

if __name__ == "__main__":
    main()
