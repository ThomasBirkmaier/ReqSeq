// The standard model (SR-139 AK3): the metamodel `workspace.init` writes, rendered from
// schemas/examples/metamodel/standard-model.yaml, the file core ships (ADR-0003), with the description of every
// type, property, relation kind and status.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { inline } from "./markdown.js";

interface Named {
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly meaning?: string;
}

/** The parts of the standard model the page shows (metamodel.schema.json). */
export interface StandardModel {
  readonly types: readonly (Named & {
    readonly prefix: string;
    readonly properties?: readonly string[];
    readonly required?: readonly string[];
  })[];
  readonly properties: readonly (Named & {
    readonly kind: string;
    readonly many?: boolean;
    readonly content?: boolean;
    readonly markdown?: boolean;
    readonly choices?: readonly Named[];
    readonly "target-types"?: readonly string[];
  })[];
  readonly relations: readonly (Named & {
    readonly "inverse-name"?: string;
    readonly "source-types"?: readonly string[];
    readonly "target-types"?: readonly string[];
  })[];
  readonly statuses: readonly (Named & { readonly initial?: boolean; readonly invalid?: boolean })[];
}

/** The page below the content folder. */
export const STANDARD_MODEL_PAGE = "reference/standard-model.md";

/** The anchor of an entry: `type-need`, `property-title`, `relation-refines`, `status-draft`. */
export const modelAnchor = (part: "type" | "property" | "relation" | "status", key: string): string =>
  `${part}-${key}`;

/** The standard model of the repository at `repoRoot`. */
export async function readStandardModel(repoRoot: string): Promise<StandardModel> {
  const file = join(repoRoot, "schemas", "examples", "metamodel", "standard-model.yaml");
  return YAML.parse(await readFile(file, "utf8"), { version: "1.2", schema: "core" }) as StandardModel;
}

const keys = (list: readonly string[] | undefined): string =>
  (list ?? []).map((key) => `\`${key}\``).join(", ");

/** One entry: an anchor, its name and key as heading, its description and its facts. */
const entry = (anchor: string, item: Named, facts: readonly (string | undefined)[]): string[] => [
  `<a id="${anchor}"></a>`,
  "",
  `### ${inline(item.name)} (\`${item.key}\`)`,
  "",
  ...(item.description === undefined ? [] : [inline(item.description), ""]),
  ...facts.filter((fact) => fact !== undefined && fact !== "").map((fact) => `- ${String(fact)}`),
  "",
];

const fact = (label: string, value: string | undefined): string | undefined =>
  value === undefined || value === "" ? undefined : `${label}: ${value}`;

/** The Markdown page of the standard model. */
export function standardModelPage(model: StandardModel): string {
  return [
    "---",
    "title: Standard model",
    "description: The types, properties, relation kinds and statuses that a new ReqSeq workspace starts with.",
    "---",
    "",
    "The metamodel that `workspace.init` writes into a new workspace. A workspace can change it; keys never change.",
    "",
    "## Types",
    "",
    ...model.types.flatMap((type) =>
      entry(modelAnchor("type", type.key), type, [
        fact("Short ID prefix", `\`${type.prefix}\``),
        fact("Meaning", type.meaning),
        fact("Properties", keys(type.properties)),
        fact("Required", keys(type.required)),
      ]),
    ),
    "## Properties",
    "",
    ...model.properties.flatMap((property) =>
      entry(modelAnchor("property", property.key), property, [
        fact("Kind", `${property.kind}${property.many === true ? ", several values" : ""}`),
        fact(
          "Choices",
          (property.choices ?? []).map((choice) => `${inline(choice.name)} (\`${choice.key}\`)`).join(", "),
        ),
        fact("Target types", keys(property["target-types"])),
        fact("Meaning", property.meaning),
        property.content === true ? "Counts to the version of the element." : undefined,
        property.markdown === true ? "Markdown text." : undefined,
      ]),
    ),
    "## Relation kinds",
    "",
    ...model.relations.flatMap((relation) =>
      entry(modelAnchor("relation", relation.key), relation, [
        fact("Inverse name", relation["inverse-name"]),
        fact("From types", keys(relation["source-types"])),
        fact("To types", keys(relation["target-types"])),
        fact("Meaning", relation.meaning),
      ]),
    ),
    "## Statuses",
    "",
    ...model.statuses.flatMap((status) =>
      entry(modelAnchor("status", status.key), status, [
        status.initial === true ? "The status of a new element." : undefined,
        status.invalid === true
          ? "Invalid: the element counts neither for coverage nor for indirect verification."
          : undefined,
      ]),
    ),
  ].join("\n");
}
