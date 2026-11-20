---
name: managing-requirements
description: "Works with needs, requirements, acceptance criteria, tests and evidence in a ReqSeq workspace. Use when creating a requirement, implementing a requirement up to its evidence, changing an element whose status is not the initial status, changing the metamodel, or checking the workspace before finishing a piece of work."
metadata:
  generator: "ReqSeq"
  reqseq-version: "0.11.0"
  reqseq-checksum: "sha256:17405a9d305c0847d6158d6c6cdc3ebd536b0852b505ad2e636e17bac8a6d456"
---

# Managing requirements with ReqSeq

Each command is named as the MCP tool, then as the command-line call; both do the same. The rules for working with ReqSeq are in the agent guide and apply to every step; this skill does not repeat them.

## First

1. Read the agent guide: `tool_guide` or `reqseq tool guide`. It names the types, statuses and evidence locations of this workspace and the rules. If neither is reachable, tell the person that ReqSeq is not connected and ask them to install it or to connect it (`workspace_connectAgent` or `reqseq workspace connect-agent`); do not work on the requirements without the guide.

## Create a requirement

1. Check the impact first, as the agent guide describes it, for each element the new requirement will point to, such as its need: read it with the targets of its relations and references (`element_get` with `{"ref":"<element>"}` or `reqseq element get '<element>'`) and its open hints (`hint_list` with `{"ref":"<element>"}` or `reqseq hint list --ref '<element>'`), query its affected elements (`trace_affected` with `{"ref":"<element>"}` or `reqseq trace affected '<element>'`), search for each new or changed term and for its identifier (`element_search` with `{"query":"<term>"}` or `reqseq element search '<term>'`), and read what you find against the change, with the records (`evidence_list` with `{"ref":"<requirement>"}` or `reqseq evidence list '<requirement>'`).
2. Create the need if it is missing, then the requirement with its acceptance criteria and its verification method: `element_create` with `{"type":"<type>","title":"<title>"}` or `reqseq element create '<type>' '<title>'`.
3. Relate the requirement to what it derives from: `relation_add` with `{"source":"<requirement>","kind":"<derivation>","target":"<target>"}` or `reqseq relation add '<requirement>' '<derivation>' '<target>'`.
4. Check the workspace: `workspace_check` or `reqseq workspace check`.

## Implement a requirement up to its evidence

1. Check the impact first, as the agent guide describes it, for the requirement: read it with the targets of its relations and references (`element_get` with `{"ref":"<element>"}` or `reqseq element get '<element>'`) and its open hints (`hint_list` with `{"ref":"<element>"}` or `reqseq hint list --ref '<element>'`), query its affected elements (`trace_affected` with `{"ref":"<element>"}` or `reqseq trace affected '<element>'`), search for each new or changed term and for its identifier (`element_search` with `{"query":"<term>"}` or `reqseq element search '<term>'`), and read what you find against the change, with the records (`evidence_list` with `{"ref":"<requirement>"}` or `reqseq evidence list '<requirement>'`).
2. Read the requirement and the reference of each acceptance criterion: `element_get` with `{"ref":"<requirement>"}` or `reqseq element get '<requirement>'`.
3. Write one test per acceptance criterion, with the reference of its criterion in its name, as the agent guide shows.
4. Run the tests with JUnit XML output and enrich the result into a new file in an evidence location: `evidence_enrichJunit` with `{"file":"<junit.xml>","item":"<item>","output":"<evidence location>/<run>.xml"}` or `reqseq evidence enrich-junit '<junit.xml>' '<item>' --output '<evidence location>/<run>.xml'`.
5. For an acceptance criterion with another verification method than test, record the check: `evidence_record` with `{"ref":"<requirement>","kind":"verification","result":"<result>"}` or `reqseq evidence record '<requirement>' verification '<result>'`.
6. Check the verification degree: `evidence_degree` or `reqseq evidence degree`.

## Check before finishing

1. Check the workspace: `workspace_check` or `reqseq workspace check`.
2. Check the verification degree (`evidence_degree` or `reqseq evidence degree`) and list the requirements without a passed test (`evidence_withoutPassedTest` or `reqseq evidence without-passed-test`).
3. Name each problem and each gap you found when you report the work.

## Change an element whose status is not the initial status

1. Check the impact first, as the agent guide describes it, for the element: read it with the targets of its relations and references (`element_get` with `{"ref":"<element>"}` or `reqseq element get '<element>'`) and its open hints (`hint_list` with `{"ref":"<element>"}` or `reqseq hint list --ref '<element>'`), query its affected elements (`trace_affected` with `{"ref":"<element>"}` or `reqseq trace affected '<element>'`), search for each new or changed term and for its identifier (`element_search` with `{"query":"<term>"}` or `reqseq element search '<term>'`), and read what you find against the change, with the records (`evidence_list` with `{"ref":"<requirement>"}` or `reqseq evidence list '<requirement>'`).
2. Ask the person before the change, as the rules of the agent guide say, and name both ways: change the element (`element_update` with `{"ref":"<element>"}` or `reqseq element update '<element>'`), or supersede it with a successor (`element_supersede` with `{"ref":"<element>","status":"<status>","successor":"<successor>"}` or `reqseq element supersede '<element>' '<status>' --successor '<successor>'`).
3. Carry out the way the person chose, through the commands.
4. Check the workspace: `workspace_check` or `reqseq workspace check`.

## Change the metamodel

1. Read the metamodel (`metamodel_get` or `reqseq metamodel get`), then propose the change with its rationale to the person.
2. Wait for the person's explicit decision, as the rules of the agent guide say.
3. Carry out the decision with the command for it: `metamodel_addType` with `{"name":"<name>","prefix":"<prefix>"}` or `reqseq metamodel add-type '<name>' '<prefix>'`; `metamodel_changeType` with `{"type":"<type>"}` or `reqseq metamodel change-type '<type>'`; `metamodel_removeType` with `{"type":"<type>"}` or `reqseq metamodel remove-type '<type>'`; `metamodel_addProperty` with `{"type":"<type>","required":false}` or `reqseq metamodel add-property '<type>' --no-required`; `metamodel_changeProperty` with `{"property":"<property>"}` or `reqseq metamodel change-property '<property>'`; `metamodel_removeProperty` with `{"type":"<type>","property":"<property>"}` or `reqseq metamodel remove-property '<type>' '<property>'`; `metamodel_addRelationKind` with `{"name":"<name>"}` or `reqseq metamodel add-relation-kind '<name>'`; `metamodel_changeRelationKind` with `{"kind":"<kind>"}` or `reqseq metamodel change-relation-kind '<kind>'`; `metamodel_removeRelationKind` with `{"kind":"<kind>"}` or `reqseq metamodel remove-relation-kind '<kind>'`; `metamodel_addStatus` with `{"type":"<type>"}` or `reqseq metamodel add-status '<type>'`; `metamodel_changeStatus` with `{"status":"<status>"}` or `reqseq metamodel change-status '<status>'`; `metamodel_removeStatus` with `{"type":"<type>","status":"<status>"}` or `reqseq metamodel remove-status '<type>' '<status>'`.
4. Check the workspace: `workspace_check` or `reqseq workspace check`.
5. Read the agent guide again (`tool_guide` or `reqseq tool guide`), because it names the types and statuses of the changed metamodel.
