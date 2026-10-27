#!/usr/bin/env python3
# Creates stage epics and one issue per SR (sr-issues skill). Idempotent via body markers.
import json, subprocess, hashlib, re, os, sys, time
REPO = "repos/ThomasBirkmaier/logreq"
SPEC = sys.argv[1] if __name__ == "__main__" else "spec"
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

# The spec is the LogReq workspace in spec/ (D-064, #326). It is read with LogReq itself (`pnpm build` first),
# so this script sees exactly what every other access sees.
LOGREQ = [os.environ.get("NODE", "node"), os.path.join(os.path.dirname(__file__), "..", "..", "packages", "cli", "dist", "bin.js")]
METHOD = {"test": "Test", "inspection": "Inspektion", "demonstration": "Demonstration", "analysis": "Analyse"}
LINK = re.compile(r"\[([^\]\n]*)\]\(logreq:[^)\n]*\)")

def logreq(*args):
    r = subprocess.run(LOGREQ + list(args) + ["--workspace", SPEC, "--json"], capture_output=True, text=True, encoding="utf8")
    if r.returncode:
        raise SystemExit(f"logreq {' '.join(args)}: {r.stdout} {r.stderr}")
    return json.loads(r.stdout)

def system_requirements():
    query = {"selection": {"where": {"type": ["system-requirement"]}}, "sort": [{"by": "spec-id"}], "withText": True, "limit": 5000}
    out = logreq("element", "list", "--input", json.dumps(query))
    if out.get("incomplete"):
        raise SystemExit("the spec workspace is incomplete")
    return out["elements"]

def stage_of(e):
    """Stage key ("3", "querschnitt") from the package the SR names (identifier Stufe-3, Querschnitt), or None."""
    ids = [r.get("identifier", "") for r in e["relations"] if r["kind"] == "packages" and r["direction"] == "out"]
    if len(ids) != 1 or ids[0] == "":
        return None
    return ids[0][len("Stufe-"):] if ids[0].startswith("Stufe-") else ids[0].lower()

# Wishes parked during a stage (package Später, Thomas 2026-10-27): no stage yet, so no issue from this script.
PARKED = "später"

def invalid_statuses():
    """Status keys the metamodel of the spec marks invalid (D-044), e.g. obsolete."""
    return {st["key"] for st in logreq("metamodel", "get")["statuses"] if st.get("invalid")}

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
        elif st not in stages:
            problems.append(f"{sr}: package {st} is no stage ({', '.join(stages)})")
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

def main():
    srs = system_requirements()
    invalid = invalid_statuses()
    problems = validate([e for e in srs if e.get("status") not in invalid], list(D035) + ["querschnitt"])
    if problems:
        raise SystemExit("nothing written; fix the spec first:\n  " + "\n  ".join(problems))
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
            text = f"Scope after D-035: \"{SCOPE[n]}\".\n\nStage acceptance (D-035, D-050): all SRs of the stage closed, `pnpm trace-check --stage {n}` green, cross-cutting SRs checked, verification records in `verification/` confirmed by the product owner."
            if n == "1":
                text += "\n\nN-036 (50,000 requirements) is the performance benchmark from stage 1 on (D-035)."
            if n == "3":
                text += ("\n\n**UI acceptance gate (N-032).** The product owner personally accepts the look and feel of the app before stage 3 closes. "
                         "N-032: \"Das Tool muss im täglichen Gebrauch einfach und minimalistisch sein und ästhetisch überzeugen, schon beim ersten Eindruck. Maßstab ist Logseq.\" "
                         "There is no SR for this; agents prepare screenshots and a short demo and label the epic `needs-human`. Agents never mark it as accepted.")
        body = f"{marker}\n{text}\n\nSub-issues: the SR issues of this group."
        e = find(marker)
        if DRY:
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
        stage_txt = "Querschnitt (all stages)" if st == "querschnitt" else f"Stage {st}"
        rel = []
        targets = lambda kind: ", ".join(r.get("identifier", r["shortId"]) for r in e["relations"] if r["kind"] == kind and r["direction"] == "out")
        if targets("derives-from"): rel.append("Derives from: " + targets("derives-from"))
        if targets("based-on"): rel.append("Based on: " + targets("based-on"))
        head = (f"<!-- sr:{sr} -->\n**{sr}** · UUID `{e['id']}` · {stage_txt} · Thema {thema} · Nachweismethode {METHOD.get(p.get('verification-method'), p.get('verification-method', ''))}\n"
                + (" · ".join(rel) + "\n" if rel else "")
                + f"\n{text}\n\n**Akzeptanzkriterien**\n{aks}\n\nSpec: `spec/{e['file']}` (`logreq element get {sr} --workspace spec`)\n\n<!-- spec-content:{h} -->\n")
        labels = ["sr", f"thema:{slug}"] + (["querschnitt"] if st == "querschnitt" else [f"stage:{st}"])
        title = f"{sr} {e['title']}"
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
                existing = [label["name"] for label in i.get("labels", [])]
                reopen = i["state"] == "closed" and quoted_changed(old, head, h)
                patch = {"title": title, "body": head + tail, "labels": merged_labels(existing, labels, ["spec-geändert"] if reopen else [])}
                if reopen:
                    patch["state"] = "open"
                api(f"issues/{i['number']}", "PATCH", patch); updated += 1; time.sleep(1)
        print(sr, i["number"], flush=True)
    print(f"created {created}, updated {updated}")

if __name__ == "__main__":
    main()
