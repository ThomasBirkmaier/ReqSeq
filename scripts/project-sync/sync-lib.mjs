// Pure parts of the project sync (sync.mjs): the fields derived from labels, the difference between
// issues and board items, and the retry of transient GitHub errors.

export const TOPICS = {
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
export const FIELDS = {
  Stage: ["0", "1", "2", "3", "4", "5", "6", "Querschnitt", "Später"],
  Kind: ["Epic", "SR", "Enabler", "Bug", "Spec question", "Other"],
  "Agent state": ["Ready", "Working", "Blocked", "Needs human", "Done"],
  Thema: Object.values(TOPICS),
  SR: null, // text
};

function kindOf(issue, has) {
  if ((issue.body ?? "").includes("<!-- epic:")) {
    return "Epic";
  }
  const kinds = [
    ["sr", "SR"],
    ["enabler", "Enabler"],
    ["bug", "Bug"],
    ["spec-frage", "Spec question"],
  ];
  return kinds.find(([label]) => has(label))?.[1] ?? "Other";
}

function agentStateOf(issue, has) {
  if (issue.state === "closed") {
    return "Done";
  }
  if (has("needs-human")) {
    return "Needs human";
  }
  if (has("blocked") || has("spec-frage")) {
    return "Blocked";
  }
  return has("agent:working") ? "Working" : "Ready";
}

/** The project field values of an issue (REST shape), derived from its labels, state, body and title. */
export function derive(issue) {
  const labels = issue.labels.map((l) => (typeof l === "string" ? l : l.name));
  const has = (l) => labels.includes(l);
  const stageLabel = labels.find((l) => l.startsWith("stage:"))?.slice(6);
  const stage = has("querschnitt") ? "Querschnitt" : stageLabel === "later" ? "Später" : stageLabel;
  const topic = TOPICS[labels.find((l) => l.startsWith("thema:"))?.slice(6)];
  const sr = issue.title.match(/^SR-\d{3}/)?.[0];
  return {
    Stage: stage,
    Kind: kindOf(issue, has),
    "Agent state": agentStateOf(issue, has),
    Thema: topic,
    SR: sr,
  };
}

/** Field name → value of a board item, from its GraphQL `fieldValues` nodes (single select and text only). */
export function itemValues(nodes) {
  const values = {};
  for (const n of nodes) {
    const name = n?.field?.name;
    if (name) {
      values[name] = n.name ?? n.text;
    }
  }
  return values;
}

/**
 * The writes that bring the board in line with the issues. `items` maps an issue number to
 * `{ id, values }`; `fields` maps a field name to its project field. An issue without an item gets
 * `add` first, its field writes then refer to the new item by issue number. A select value without
 * an option in the project is skipped (ensureFields warns about it).
 */
export function plan(issues, items, fields) {
  const ops = [];
  for (const issue of issues) {
    const item = items.get(issue.number);
    if (!item) {
      ops.push({ op: "add", issue });
    }
    const current = item?.values ?? {};
    for (const [name, value] of Object.entries(derive(issue))) {
      const f = fields[name];
      if (!f || current[name] === value) {
        continue;
      }
      if (value === undefined) {
        ops.push({ op: "clear", number: issue.number, field: f.id });
        continue;
      }
      if (f.options) {
        const option = f.options.find((o) => o.name === value)?.id;
        if (option) {
          ops.push({ op: "set", number: issue.number, field: f.id, value: { singleSelectOptionId: option } });
        }
        continue;
      }
      ops.push({ op: "set", number: issue.number, field: f.id, value: { text: value } });
    }
  }
  return ops;
}

/** An error worth retrying: GitHub was briefly unavailable or limited the rate. */
export class TransientError extends Error {
  constructor(message, retryAfterSeconds) {
    super(message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Whether an HTTP answer that is not ok is transient: a server error or a rate limit. */
export function transientStatus(status, body, retryAfter) {
  return (
    status >= 500 || status === 429 || (status === 403 && (retryAfter !== null || /rate limit/i.test(body)))
  );
}

/** Whether GraphQL `errors` are transient: an internal error, a timeout or a rate limit. */
export function transientGraphqlErrors(errors) {
  return errors.some(
    (e) => e.type === "RATE_LIMITED" || /something went wrong|timed? ?out|try again/i.test(e.message ?? ""),
  );
}

// 10 + 20 + 40 + 80 + 160 s: over five minutes, longer than the GraphQL outage of 2026-10-30 (#480).
export const DELAYS = [10_000, 20_000, 40_000, 80_000, 160_000];

/** Runs `fn`, and again after each delay while it throws a TransientError. */
export async function withRetry(fn, { delays = DELAYS, sleep, log }) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof TransientError) || attempt >= delays.length) {
        throw e;
      }
      const wait = Math.max(delays[attempt], (e.retryAfterSeconds ?? 0) * 1000);
      log(`::warning::${e.message}; retry ${attempt + 1}/${delays.length} in ${wait / 1000} s`);
      await sleep(wait);
    }
  }
}
