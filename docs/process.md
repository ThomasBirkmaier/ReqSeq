# Way of working

How work on ReqSeq goes from a need to a release. The rules are in `CLAUDE.md` (Issues, Traceability) and the skills it names; this page is their picture.

```mermaid
flowchart LR
  need["Need<br/><small>set by the product owner</small>"]
  concept["Concept<br/><small>dependency check, questions, mockup<br/>concept with issue cut, fable-reviewer<br/>approval of wording and cut<br/>skill spec-change</small>"]
  specpr["Spec PR<br/><small>SR in its topic package, an idea a draft SR<br/>then issues and their check</small>"]
  entry["Bug, question,<br/>task asked for"]
  issue["Issue = one task<br/><small>too large: epic with sub-issues</small>"]
  pr["Pull request<br/><small>verify before each push<br/>merge, /code-review</small>"]
  merged["Merge<br/><small>Closes # closes the issue</small>"]
  evidence["Evidence<br/><small>tests [SR/AK], nightly CI evidence</small>"]
  release["Release<br/><small>x.y with its milestone<br/>x.y.z without</small>"]

  need --> concept --> specpr --> issue
  entry --> issue
  issue --> pr --> merged --> evidence --> release
```

## Dependency check

Every spec change and every fix of a bug against an AK starts with a check of what it touches; trace finds relations and inline references, the text search finds the words.

| Path | Check | Then |
| --- | --- | --- |
| New or changed requirement, decision or glossary term | `trace affected`, `hint list`, one `element search` per term and synonym (`spec-change`) | The numbered steps of `spec-change`: for a content change questions, mockup, concept and its review, approval of the wording and the issue cut, spec PR, issues and their check; for confirming relations, a status or a typo the spec PR, which names each touchpoint. |
| Bug against an AK | `trace related` parents and children, one `element search` per term of the AK (CLAUDE.md, Issues) | Fix it. A fix that needs an interpretation of the AK wording becomes a `question`. |
| Bug without an SR | none | Fix it. |
| Spec review, only when the product owner asks | `fable-reviewer` (prompt: `Case: spec review`, the packages, the result file) reads them and writes a finding list | An Opus agent at effort high checks each finding against code and tests; decision cards; one spec PR, whose content changes follow the numbered steps of `spec-change`; implementation gaps become `bug` issues (#1298). |

## Issues

| What | Rule |
| --- | --- |
| Scope | One task that one PR finishes. Several PRs: an `epic` with sub-issues. |
| Title | English, what is different afterwards or what is wrong, keyword first, about 70 characters, no prefix. |
| Body | Opens with 1–3 sentences without jargon. `SR: SR-112 (AK1, AK2)` when it implements or breaks an AK. |
| Milestone | Every open issue has one. A step of an open epic: its sub-issue, with the epic's milestone. A bug or flake: the lowest open version x.y; any other issue: the version whose goal it serves, else the lowest open one. The product owner moves issues between milestones and opens the next milestone with its goal and exit criterion when a version x.y is released. |
| Closing | The merged PR, with `Closes #`. Without a PR only with the product owner's approval. |

## Labels

Exactly one type, area and priority per open issue; `scripts/labels.sh` holds the list and its descriptions.

| Axis | Values | On every open issue |
| --- | --- | --- |
| Type | `bug`, `feature`, `task`, `question` | exactly one |
| Area | `core`, `cli`, `api`, `mcp`, `app`, `spec`, `dev` | exactly one, where the main change is |
| Priority | `P1` must, `P2` should, `P3` could | exactly one |
| Waiting | `needs-human` | while it waits for the product owner |
| Structure | `epic`, `agent:working` | when it applies |

`nightly-check` opens an issue when a nightly run of CI or Performance is red. `evidence` opens one when the verification degree of a view falls. Workflows set `main-red`, `perf`, `dependencies` and `github_actions`; `issue-working` also sets `agent:working` on the issues a PR closes and removes it when the PR is closed. The board (`project-sync`) shows Category (type, or Epic), Area, Priority, Agent state and Status from these labels; its old fields Stage, Kind, Thema and SR are no longer written.

## Skills

| Step | Read first |
| --- | --- |
| Change the spec | `spec-change` |
| Push a change | `verify` |
| Open, review and merge a PR; release | `merge` |

## Where the rules live

Claude follows written rules as context, not as a guarantee. So each rule sits where it is loaded at the moment it applies, and a rule that must hold every time also has a check outside the session that applies it: a hook, a CI job, or the review by a second agent.

```mermaid
flowchart LR
  claude["CLAUDE.md<br/><small>loaded in every session<br/>rules for every change, triggers</small>"]
  skill["Skills<br/><small>loaded when invoked<br/>procedures with their steps</small>"]
  agent["Agents<br/><small>loaded by the subagent<br/>its task and inputs</small>"]
  check["Checks<br/><small>hooks, CI, merge review<br/>run every time</small>"]

  claude -- "names when to read" --> skill
  skill -- "starts" --> agent
  skill -- "results in a PR that" --> check
  claude -- "rules without exceptions" --> check
```

| Layer | Loaded | Holds | Example |
| --- | --- | --- | --- |
| `CLAUDE.md` | at the start of every session in this checkout, and of the project's agents (`.claude/agents/`) | product rules, repository text, issues, and the trigger for each procedure | "Before a change to `spec/`: skill `spec-change`" |
| Skill description | in every session in this checkout, as one line of the skill list (outside it maybe as `reqseq:<name>`, or not at all) | when to load the skill | `spec-change`: "Use as soon as a wish, a question or a bug could change an element in spec/" |
| Skill body (`.claude/skills/`) | when invoked, or at the start of an agent that lists it under `skills:`; it then stays in the conversation | a procedure with numbered steps | the nine steps of `spec-change` |
| Agent file (`.claude/agents/`) | its description is always listed to the thread; the body when a thread starts that agent | its task, inputs and model; it sees `CLAUDE.md` but not the thread | `implementer` does not start without the issue-check link |
| Hook (`.claude/settings.json`, `scripts/hooks/`) | on every matching tool call | a rule a script can decide on a tool call | no hand edit of spec elements or generated files (`protect-files`, Edit and Write only) |
| CI and the merge review | on every PR | what a PR must show | the six headings of a spec PR (review) |

Rules for a chat or a platform outside the repository (language of the chat, its checklists) belong to that platform's settings, not here.
