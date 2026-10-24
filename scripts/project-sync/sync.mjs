#!/usr/bin/env node
// Mirrors the repository's issues into the GitHub project "LogReq" (Projects v2).
// Labels are the source of truth; this script only derives project fields from them.
// Runs in GitHub Actions with PROJECT_TOKEN (classic PAT, scopes repo + project).
// Usage: node scripts/project-sync/sync.mjs [issue-number]   (no number: all issues)
import process from "node:process";

const token = process.env.PROJECT_TOKEN;
const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? "ThomasBirkmaier/logreq").split("/");
const PROJECT_TITLE = process.env.PROJECT_TITLE ?? "LogReq";
if (!token) {
  console.log("::notice::PROJECT_TOKEN is not set, skipping project sync.");
  process.exit(0);
}

const TOPICS = {
  "ablage-und-repositories": "Ablage und Repositories",
  "metamodell-und-typen": "Metamodell und Typen",
  "traceability-und-ketten": "Traceability und Ketten",
  "nachweis-und-abdeckung": "Nachweis und Abdeckung",
  varianten: "Varianten",
  "pakete-und-baselines": "Pakete und Baselines",
  "import-und-export": "Import und Export",
  "anbindung-und-auswertung": "Anbindung und Auswertung",
  "bearbeiten-und-finden": "Bearbeiten und Finden",
  "betrieb-und-leistung": "Betrieb und Leistung",
};
const FIELDS = {
  Stage: ["0", "1", "2", "3", "4", "5", "6", "Querschnitt"],
  Kind: ["Epic", "SR", "Enabler", "Bug", "Spec question", "Other"],
  "Agent state": ["Ready", "Working", "Blocked", "Needs human", "Done"],
  Thema: Object.values(TOPICS),
  SR: null, // text
};

async function gql(query, variables = {}) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { authorization: `bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function rest(path) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/${path}`, {
    headers: { authorization: `bearer ${token}`, accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function ensureProject() {
  const d = await gql(
    `query($o:String!,$r:String!){ user(login:$o){ id projectsV2(first:50){ nodes{ id number title } } }
       repository(owner:$o,name:$r){ id } }`,
    { o: owner, r: repo },
  );
  let p = d.user.projectsV2.nodes.find((n) => n.title === PROJECT_TITLE);
  if (!p) {
    p = (
      await gql(
        `mutation($o:ID!,$t:String!){ createProjectV2(input:{ownerId:$o,title:$t}){ projectV2{ id number title } } }`,
        { o: d.user.id, t: PROJECT_TITLE },
      )
    ).createProjectV2.projectV2;
    await gql(
      `mutation($p:ID!,$r:ID!){ linkProjectV2ToRepository(input:{projectId:$p,repositoryId:$r}){ clientMutationId } }`,
      { p: p.id, r: d.repository.id },
    );
    console.log(`created project #${p.number}`);
  }
  return p;
}

async function ensureFields(projectId) {
  const q = async () =>
    (
      await gql(
        `query($p:ID!){ node(id:$p){ ... on ProjectV2 { fields(first:50){ nodes{
        ... on ProjectV2FieldCommon { id name }
        ... on ProjectV2SingleSelectField { options { id name } } } } } } }`,
        { p: projectId },
      )
    ).node.fields.nodes;
  let fields = await q();
  for (const [name, options] of Object.entries(FIELDS)) {
    const f = fields.find((x) => x.name === name);
    if (f) {
      const missing = (options ?? []).filter((o) => !f.options?.some((x) => x.name === o));
      if (missing.length)
        console.log(
          `::warning::field ${name} lacks options ${missing.join(", ")}; add them in the project settings.`,
        );
      continue;
    }
    await gql(
      `mutation($p:ID!,$n:String!,$t:ProjectV2CustomFieldType!,$o:[ProjectV2SingleSelectFieldOptionInput!]){
        createProjectV2Field(input:{projectId:$p,name:$n,dataType:$t,singleSelectOptions:$o}){ clientMutationId } }`,
      {
        p: projectId,
        n: name,
        t: options ? "SINGLE_SELECT" : "TEXT",
        o: options ? options.map((o) => ({ name: o, color: "GRAY", description: "" })) : null,
      },
    );
    console.log(`created field ${name}`);
  }
  fields = await q();
  return Object.fromEntries(fields.map((f) => [f.name, f]));
}

function derive(issue) {
  const labels = issue.labels.map((l) => (typeof l === "string" ? l : l.name));
  const has = (l) => labels.includes(l);
  const stage = has("querschnitt") ? "Querschnitt" : labels.find((l) => l.startsWith("stage:"))?.slice(6);
  const kind = (issue.body ?? "").includes("<!-- epic:")
    ? "Epic"
    : has("sr")
      ? "SR"
      : has("enabler")
        ? "Enabler"
        : has("bug")
          ? "Bug"
          : has("spec-frage")
            ? "Spec question"
            : "Other";
  const state =
    issue.state === "closed"
      ? "Done"
      : has("needs-human")
        ? "Needs human"
        : has("blocked") || has("spec-frage")
          ? "Blocked"
          : has("agent:working")
            ? "Working"
            : "Ready";
  const topic = TOPICS[labels.find((l) => l.startsWith("thema:"))?.slice(6)];
  const sr = issue.title.match(/^SR-\d{3}/)?.[0];
  return { Stage: stage, Kind: kind, "Agent state": state, Thema: topic, SR: sr };
}

async function syncIssue(project, fields, issue) {
  const item = (
    await gql(
      `mutation($p:ID!,$c:ID!){ addProjectV2ItemById(input:{projectId:$p,contentId:$c}){ item{ id } } }`,
      { p: project.id, c: issue.node_id },
    )
  ).addProjectV2ItemById.item.id;
  for (const [name, value] of Object.entries(derive(issue))) {
    const f = fields[name];
    if (!f) continue;
    if (value === undefined) {
      await gql(
        `mutation($p:ID!,$i:ID!,$f:ID!){ clearProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f}){ clientMutationId } }`,
        { p: project.id, i: item, f: f.id },
      );
      continue;
    }
    const v = f.options
      ? { singleSelectOptionId: f.options.find((o) => o.name === value)?.id }
      : { text: value };
    if (f.options && !v.singleSelectOptionId) continue;
    await gql(
      `mutation($p:ID!,$i:ID!,$f:ID!,$v:ProjectV2FieldValue!){
        updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:$v}){ clientMutationId } }`,
      { p: project.id, i: item, f: f.id, v },
    );
  }
}

const project = await ensureProject();
const fields = await ensureFields(project.id);
const one = process.argv[2];
let issues = [];
if (one) issues = [await rest(`issues/${one}`)];
else
  for (let page = 1; ; page++) {
    const batch = await rest(`issues?state=all&per_page=100&page=${page}`);
    issues.push(...batch.filter((i) => !i.pull_request));
    if (batch.length < 100) break;
  }
for (const issue of issues) await syncIssue(project, fields, issue);
console.log(`synced ${issues.length} issue(s) into project #${project.number}`);
