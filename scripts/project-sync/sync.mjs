#!/usr/bin/env node
// Mirrors the repository's issues into the GitHub project "ReqSeq" (Projects v2).
// Labels are the source of truth; this script only derives project fields from them.
// Runs in GitHub Actions with PROJECT_TOKEN (classic PAT, scopes repo + project).
// Every run reconciles all issues and writes only differences (#480): the workflow keeps one pending
// run, and dropping the others is harmless, because the last run catches up on every change.
// Usage: node scripts/project-sync/sync.mjs
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import {
  FIELDS,
  TransientError,
  itemValues,
  plan,
  transientGraphqlErrors,
  transientStatus,
  withRetry,
} from "./sync-lib.mjs";

const token = process.env.PROJECT_TOKEN;
const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? "ThomasBirkmaier/ReqSeq").split("/");
const PROJECT_TITLE = process.env.PROJECT_TITLE ?? "ReqSeq";
if (!token) {
  console.log("::notice::PROJECT_TOKEN is not set, skipping project sync.");
  process.exit(0);
}

/** One request; a network error, server error or rate limit becomes a TransientError. */
async function request(url, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw new TransientError(`${url}: ${e.message}`);
  }
  if (!res.ok) {
    const body = await res.text();
    const retryAfter = res.headers.get("retry-after");
    const message = `${url}: ${res.status} ${body}`;
    if (transientStatus(res.status, body, retryAfter)) {
      throw new TransientError(message, Number(retryAfter ?? 0));
    }
    throw new Error(message);
  }
  return res.json();
}

const retry = (fn) => withRetry(fn, { sleep, log: console.log });

function gql(query, variables = {}) {
  return retry(async () => {
    const json = await request("https://api.github.com/graphql", {
      method: "POST",
      headers: { authorization: `bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (json.errors) {
      const message = JSON.stringify(json.errors);
      throw transientGraphqlErrors(json.errors) ? new TransientError(message) : new Error(message);
    }
    return json.data;
  });
}

function rest(path) {
  return retry(() =>
    request(`https://api.github.com/repos/${owner}/${repo}/${path}`, {
      headers: { authorization: `bearer ${token}`, accept: "application/vnd.github+json" },
    }),
  );
}

async function ensureProject() {
  const d = await gql(
    `query($o:String!){ user(login:$o){ projectsV2(first:50){ nodes{ id number title } } } }`,
    { o: owner },
  );
  // Never creates a project: a missing title means the project is being renamed, and a new one would
  // split the board. The run is skipped until the title matches again.
  const p = d.user.projectsV2.nodes.find((n) => n.title === PROJECT_TITLE);
  if (!p) {
    console.log(`::notice::No project titled "${PROJECT_TITLE}", skipping project sync.`);
    process.exit(0);
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
      if (missing.length) {
        console.log(
          `::warning::field ${name} lacks options ${missing.join(", ")}; add them in the project settings.`,
        );
      }
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

/** The board items of this repository's issues: issue number → { id, values }. */
async function loadItems(projectId) {
  const items = new Map();
  const full = `${owner}/${repo}`.toLowerCase();
  for (let after = null; ;) {
    const page = (
      await gql(
        `query($p:ID!,$a:String){ node(id:$p){ ... on ProjectV2 { items(first:100, after:$a){
        pageInfo{ hasNextPage endCursor }
        nodes{ id content{ ... on Issue { number repository{ nameWithOwner } } }
          fieldValues(first:20){ nodes{
            ... on ProjectV2ItemFieldSingleSelectValue { name field{ ... on ProjectV2FieldCommon { name } } }
            ... on ProjectV2ItemFieldTextValue { text field{ ... on ProjectV2FieldCommon { name } } } } } } } } } }`,
        { p: projectId, a: after },
      )
    ).node.items;
    for (const n of page.nodes) {
      if (n.content?.repository?.nameWithOwner.toLowerCase() === full) {
        items.set(n.content.number, { id: n.id, values: itemValues(n.fieldValues.nodes) });
      }
    }
    if (!page.pageInfo.hasNextPage) {
      return items;
    }
    after = page.pageInfo.endCursor;
  }
}

async function loadIssues() {
  const issues = [];
  for (let page = 1; ; page++) {
    const batch = await rest(`issues?state=all&per_page=100&page=${page}`);
    issues.push(...batch.filter((i) => !i.pull_request));
    if (batch.length < 100) {
      return issues;
    }
  }
}

const project = await ensureProject();
const fields = await ensureFields(project.id);
const [issues, items] = await Promise.all([loadIssues(), loadItems(project.id)]);
const ops = plan(issues, items, fields);
const itemIds = new Map([...items].map(([number, item]) => [number, item.id]));
for (const o of ops) {
  if (o.op === "add") {
    const added = await gql(
      `mutation($p:ID!,$c:ID!){ addProjectV2ItemById(input:{projectId:$p,contentId:$c}){ item{ id } } }`,
      { p: project.id, c: o.issue.node_id },
    );
    itemIds.set(o.issue.number, added.addProjectV2ItemById.item.id);
  } else if (o.op === "clear") {
    await gql(
      `mutation($p:ID!,$i:ID!,$f:ID!){ clearProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f}){ clientMutationId } }`,
      { p: project.id, i: itemIds.get(o.number), f: o.field },
    );
  } else {
    await gql(
      `mutation($p:ID!,$i:ID!,$f:ID!,$v:ProjectV2FieldValue!){
        updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:$v}){ clientMutationId } }`,
      { p: project.id, i: itemIds.get(o.number), f: o.field, v: o.value },
    );
  }
}
console.log(
  `reconciled ${issues.length} issue(s) with project #${project.number}: ` +
    `${ops.filter((o) => o.op === "add").length} added, ${ops.filter((o) => o.op !== "add").length} field write(s)`,
);
