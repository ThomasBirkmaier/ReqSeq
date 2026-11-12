// The graph of an element (SR-151 AK1, AK6) and the graph of the metamodel (AK2) as a Mermaid flowchart:
// the same nodes, edges and words as the app's graphs (`words.ts`, `metamodel/graph.ts`), as text. The
// same output gives the same bytes on every platform (AK4): LF, no trailing spaces, a final newline, no
// time and no path.
//
// Escaping (checked by rendering with Mermaid 11, `htmlLabels: false`, `securityLevel: strict`): every
// label is quoted. In a node label `#` becomes `#35;` first, so no text turns into an entity, then `&`,
// `<`, `>` and `"` become `#amp;`, `#lt;`, `#gt;` and `#quot;`, `:` becomes `#58;` (else a line can read
// as a `style` statement) and `{` becomes `#123;` (else `%%{` starts a directive); every node label holds
// a raw `<br/>`, so the entities are decoded. In an edge label only `&`, `<` and `>` become entities; a
// `"` there becomes `'` and a `#word;` stays as written, which Mermaid shows as an entity: a known
// limitation for the names of kinds and properties. Line breaks and other control characters become one
// space, everywhere.
import type { CommandOutput } from "../catalog.js";
import type { MetamodelNode } from "../metamodel/graph.js";
import { ANY_KEY, linkLabel, metamodelGraph } from "../metamodel/graph.js";
import { MARK_WORDS, kindName, shownId, typeName, verificationWords } from "./words.js";

type ElementGraph = Pick<
  CommandOutput<"trace.graph">,
  "root" | "nodes" | "edges" | "truncated" | "incomplete"
>;

/** The line break inside a label. */
const BR = "<br/>";

/** Control characters and line or paragraph separators. */
const CONTROL = /[\p{Cc}\p{Zl}\p{Zp}]+/gu;

/** One line of a node label: control characters as a space, `#` first, then the other entities. */
export const nodeText = (text: string): string =>
  text
    .replace(CONTROL, " ")
    .replaceAll("#", "#35;")
    .replaceAll("&", "#amp;")
    .replaceAll("<", "#lt;")
    .replaceAll(">", "#gt;")
    .replaceAll('"', "#quot;")
    .replaceAll(":", "#58;")
    .replaceAll("{", "#123;");

/** One line of an edge label (see the file comment). */
export const edgeText = (text: string): string =>
  text
    .replace(CONTROL, " ")
    .replaceAll("&", "#amp;")
    .replaceAll("<", "#lt;")
    .replaceAll(">", "#gt;")
    .replaceAll('"', "'");

const node = (id: string, lines: readonly string[]): string => `  ${id}["${lines.map(nodeText).join(BR)}"]`;

const edge = (source: string, target: string, label: string, dashed = false): string =>
  `  ${source} ${dashed ? "-.->" : "-->"}|"${label}"| ${target}`;

const text = (lines: readonly string[]): string => `${lines.join("\n")}\n`;

/**
 * The flowchart of an element's graph (AK1): one node per node of the output, in its order, as `n0`,
 * `n1`, …: "<short ID (identifier)> · <type>", the title, then the marks and the verification words when
 * there are any. The element has a thicker frame (D-062: no colour). One edge per edge of the output, from
 * the source to the target, labelled with the name of its kind and "· outdated"; inline references dashed.
 * First a comment when `limit` left out elements (AK6), then one when the graph is incomplete.
 */
export const elementMermaid = (
  graph: ElementGraph,
  typeNames: ReadonlyMap<string, string>,
  kindNames: ReadonlyMap<string, string>,
): string => {
  const ids = new Map(
    graph.nodes.map((each, index) => [`${each.repository}:${each.id}`, `n${String(index)}`]),
  );
  // Every edge of the output joins two of its nodes.
  const idOf = (repository: string, id: string): string => String(ids.get(`${repository}:${id}`));
  const rootIndex = graph.nodes.findIndex((each) => each.id === graph.root);
  return text([
    ...(graph.truncated ? ["%% truncated: more elements are reachable than shown"] : []),
    ...(graph.incomplete
      ? ["%% incomplete: not every repository or evidence location is on this machine"]
      : []),
    "flowchart BT",
    ...graph.nodes.map((each, index) => {
      const words = [...each.marks.map((mark) => MARK_WORDS[mark]), ...verificationWords(each)];
      return node(`n${String(index)}`, [
        `${shownId(each.shortId, each.identifier)} · ${typeName(typeNames, each.type)}`,
        each.title,
        ...(words.length === 0 ? [] : [words.join(" ")]),
      ]);
    }),
    "  classDef element stroke-width:3px",
    `  class n${String(rootIndex)} element`,
    ...graph.edges.map((link) =>
      edge(
        idOf(link.sourceRepository, link.source),
        idOf(link.targetRepository, link.target),
        edgeText([kindName(link, kindNames), ...(link.outdated ? ["outdated"] : [])].join(" · ")),
        link.link === "reference",
      ),
    ),
  ]);
};

/** The lines of a type box: "<name> (<prefix>)", then its properties, the inherited ones marked. */
const boxLines = (box: MetamodelNode): string[] =>
  box.any
    ? [box.name, ""]
    : [
        `${box.name} (${box.prefix})`,
        box.properties
          .map((property) => `${property.name}${property.inherited ? " (inherited)" : ""}`)
          .join(" · "),
      ];

/**
 * The flowchart of the metamodel (AK2): one node per box of `metamodelGraph`, "Any type" only when it has
 * one, and one edge per ordered pair with one label line per link, as the app's graph shows them.
 */
export const metamodelMermaid = (output: CommandOutput<"metamodel.get">): string => {
  const graph = metamodelGraph(output);
  const ids = new Map(
    graph.nodes.map((box, index) => [box.key, box.key === ANY_KEY ? "any" : `m${String(index)}`]),
  );
  // Every edge of the graph joins two of its nodes.
  const idOf = (key: string): string => String(ids.get(key));
  return text([
    "flowchart BT",
    ...graph.nodes.map((box) => node(idOf(box.key), boxLines(box))),
    ...graph.edges.map((link) =>
      edge(
        idOf(link.source),
        idOf(link.target),
        link.links.map((each) => edgeText(linkLabel(each))).join(BR),
      ),
    ),
  ]);
};
