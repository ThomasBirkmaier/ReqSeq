// The values each source of a catalog argument offers (`OFFERS`, SR-108 AK4), each read by one existing read
// command, and the offer of the argument the command prompt asks (`offerFor`, `catalog-commands.ts`).

import type { CommandTypes } from "@reqseq/core";
import type { CommandListing } from "../shared/protocol.js";
import type { ActionContext } from "./action-types.js";
import { criterionLabel } from "@reqseq/core/criterion-items";
import { CREATE_COMMAND, creatableTypes } from "./create-element.js";
import { refIdTitle, shownId, shownIdTitle } from "./id-title.js";
import type { Entry, Failed, Offer, Value } from "./catalog-entry.js";
import { failed, listOf, ordered } from "./catalog-entry.js";
import { offerGroups } from "./group-prompt.js";
import { offeredFields } from "./search-fields.js";
import { viewName, viewsOf } from "./views.js";
import type { Argument, Source } from "./catalog-arguments.js";
import { contextField, groupReads, schemaOf, inputOf } from "./catalog-arguments.js";

const numberOr = (text: string): unknown => {
  const value = Number(text);
  return text.trim() !== "" && Number.isFinite(value) ? value : text;
};

const jsonOr = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Not JSON: core says what is wrong with the text.
    return text;
  }
};

/** What a source needs to offer its values: the command, the field and the value of the field it reads. */
interface Asked {
  readonly context: ActionContext;
  readonly command: CommandListing;
  readonly field: string;
  /** The value of the field the source reads (`contextField`); of a list field (`refs`) its first value. */
  readonly of: unknown;
  /** The source of that field: an element, a relation kind, a relation, a property. */
  readonly ofSource?: Source;
  /**
   * The value of the field that field reads in turn: the source of a kind (`relation.add target` ← `kind` ←
   * `source`). The chain is at most these two steps (the plan's rule for `of`); a source never reads further.
   */
  readonly before: unknown;
  /** The values already given to this field (a list such as `hintIds`): not offered again. */
  readonly taken: readonly unknown[];
  /** The meaning of the type of the elements an element argument takes (`variant`, `package`). */
  readonly meaning?: string;
  /** The value given to `repository` in this run, if any: the files of an ambiguous reference are its. */
  readonly repository?: unknown;
  /** The values of the fields of `groupReads` in the input: the selection a `group` is offered for. */
  readonly reads: Readonly<Record<string, unknown>>;
}

/** The element `ref` names, as `element.get` gives it; nothing without a reference. */
const elementOf = async (
  context: ActionContext,
  ref: unknown,
): Promise<CommandTypes["element.get"]["output"]["element"] | Failed | undefined> => {
  if (typeof ref !== "string") {
    return undefined;
  }
  const answer = await context.call("element.get", { ref });
  return answer.ok ? answer.output.element : { kind: "failed", message: answer.message };
};

/**
 * The statuses the type of the element `ref` names allows, by name (`metamodel.get`), only the invalid
 * ones for `invalidStatus` (`element.supersede`); without an element every status of the metamodel.
 */
const statuses =
  (invalid: boolean) =>
  async ({ context, of }: Asked): Promise<Offer | Failed> => {
    const element = await elementOf(context, of);
    if (failed(element)) {
      return element;
    }
    return listOf(await context.call("metamodel.get", {}), (output) => {
      const allowed = output.types.find((type) => type.key === element?.type)?.statuses;
      return output.statuses
        .filter((status) => (allowed?.includes(status.key) ?? true) && (!invalid || status.invalid === true))
        .map((status) => ({ value: status.key, name: status.name, key: status.key }));
    });
  };

/** Elements of the types `types` (all types without them; none for an empty list, which allows none). */
const elementsOf = (types: readonly string[] | undefined, target = false): Offer =>
  types?.length === 0
    ? { kind: "list", values: [] }
    : { kind: "element", ...(types === undefined ? {} : { types }), ...(target ? { target: true } : {}) };

const typed = (parse: (text: string) => unknown) => (): Promise<Offer> =>
  Promise.resolve({ kind: "text", parse });
const asText = typed((text) => text);

/**
 * The elements of the types with the meaning `meaning` (`metamodel.get`, then `element.list`), as `viewsOf`
 * reads the variants, without `core`; none when no type has it.
 */
const elementsWithMeaning = async (context: ActionContext, meaning: string): Promise<Offer | Failed> => {
  const metamodel = await context.call("metamodel.get", {});
  if (!metamodel.ok) {
    return { kind: "failed", message: metamodel.message };
  }
  const types = metamodel.output.types.filter((type) => type.meaning === meaning).map((type) => type.key);
  if (types.length === 0) {
    return { kind: "list", values: [] };
  }
  return listOf(
    await context.call("element.list", { selection: { where: { type: types } }, limit: 5000 }),
    (output) =>
      (output.elements ?? []).map((element) => ({
        value: element.id,
        name: shownIdTitle(element.shortId, element.identifier, element.title),
        label: shownId(element.shortId, element.identifier),
      })),
  );
};

/** A file of an element, with its repository beside it. */
interface ElementFile {
  readonly repository: string;
  readonly file: string;
}

/** The elements `details.candidates` of `ref.ambiguous` names by repository and file; none in other details. */
const candidatesOf = (details: Readonly<Record<string, unknown>> | undefined): readonly ElementFile[] => {
  const candidates = details?.["candidates"];
  return Array.isArray(candidates)
    ? candidates.flatMap((candidate: unknown) => {
        const { repository, file } = (candidate ?? {}) as Partial<Record<string, unknown>>;
        return typeof repository === "string" && typeof file === "string" ? [{ repository, file }] : [];
      })
    : [];
};

/**
 * The hits of the files of an ambiguous reference, each by its repository and file. A file two of them hold
 * goes in with its repository, which tells them apart (`element.get` `file`: "Give repository too").
 */
const fileValues = (candidates: readonly ElementFile[]): Value[] =>
  candidates.map((candidate) => ({
    ...fileValue(candidate),
    id: JSON.stringify([candidate.repository, candidate.file]),
    ...(candidates.filter(({ file }) => file === candidate.file).length > 1
      ? { also: { field: "repository", value: candidate.repository } }
      : {}),
  }));

const fileValue = ({ repository, file }: ElementFile): Value => ({
  value: file,
  name: file,
  key: repository,
});

/**
 * Each source and the read command that gives its values (ADR-0002 rule 1). `relationKind`: the kinds
 * `relation.options` allows from the element it reads, without one every kind of the metamodel.
 */
const OFFERS: Readonly<Record<Source, (asked: Asked) => Promise<Offer | Failed>>> = {
  // With a meaning, the elements of the types with that meaning (the variants, the packages) as hits.
  element: ({ context, meaning }) =>
    meaning === undefined ? Promise.resolve({ kind: "element" }) : elementsWithMeaning(context, meaning),
  // A new element: only the types that are not abstract, each with the required properties asked next.
  type: async ({ context, command }) =>
    listOf(await context.call("metamodel.get", {}), (output) =>
      command.name === CREATE_COMMAND
        ? creatableTypes(output).map((type) => ({
            value: type.key,
            name: type.name,
            key: type.key,
            asks: type.required,
          }))
        : output.types.map((type) => ({ value: type.key, name: type.name, key: type.key })),
    ),
  relationKind: async ({ context, of }) =>
    typeof of === "string"
      ? listOf(await context.call("relation.options", { ref: of }), (output) =>
          output.kinds.map((kind) => ({ value: kind.kind, name: kind.name, key: kind.kind })),
        )
      : listOf(await context.call("metamodel.get", {}), (output) =>
          output.relations.map((kind) => ({ value: kind.key, name: kind.name, key: kind.key })),
        ),
  repository: async ({ context }) =>
    listOf(await context.call("workspace.status", {}), (output) =>
      output.repositories.map((repository) => ({ value: repository.name, name: repository.name })),
    ),
  choice: ({ command, field }) => {
    const schema = schemaOf(command, field);
    const values = (schema.enum ?? schema.items?.enum ?? []).map(String);
    return Promise.resolve({ kind: "list", values: values.map((value) => ({ value, name: value })) });
  },
  boolean: () =>
    Promise.resolve({
      kind: "list",
      values: [
        { value: true, name: "yes" },
        { value: false, name: "no" },
      ],
    }),
  number: typed(numberOr),
  json: typed(jsonOr),
  text: asText,
  // A path, completed with the entries `workspace.listFolder` gives for the typed text (SR-143 AK2).
  folder: () => Promise.resolve({ kind: "path", files: false }),
  file: () => Promise.resolve({ kind: "path", files: true }),
  // Never asked: the shown list's selection (`inputOf`).
  selection: asText,
  // The sources of the write commands (SR-108 AK4): the values the metamodel allows, each from one read
  // command, as ADR-0010 lists them.
  status: statuses(false),
  invalidStatus: statuses(true),
  // The properties of the element's type; without an element (`element.bulkUpdate`) every property of the
  // metamodel. Never the title, which the commands that take a property refuse.
  property: async ({ context, of }) => {
    const element = await elementOf(context, of);
    if (failed(element)) {
      return element;
    }
    return listOf(await context.call("metamodel.get", {}), (output) => {
      const typed = output.types.find((type) => type.key === element?.type)?.properties;
      return output.properties
        .filter((property) => (typed?.includes(property.key) ?? true) && property.meaning !== "title")
        .map((property) => ({ value: property.key, name: property.name, key: property.key }));
    });
  },
  // The values of the property it reads: its choices, elements of its target types, else typed text.
  value: async ({ context, of }) => {
    const answer = await context.call("metamodel.get", {});
    if (!answer.ok) {
      return { kind: "failed", message: answer.message };
    }
    const property = answer.output.properties.find((candidate) => candidate.key === of);
    return property?.kind === "choice"
      ? {
          kind: "list",
          values: (property.choices ?? []).map((choice) => ({
            value: choice.key,
            name: choice.name,
            key: choice.key,
          })),
        }
      : property?.kind === "relation"
        ? elementsOf(property["target-types"], true)
        : property?.kind === "number"
          ? await typed(numberOr)()
          : await asText();
  },
  // Elements of the target types of the kind it reads: from the element the kind was offered for
  // (`relation.options`), else from the metamodel.
  relationTarget: async ({ context, of, before }) => {
    if (typeof before === "string") {
      const answer = await context.call("relation.options", { ref: before });
      if (!answer.ok) {
        return { kind: "failed", message: answer.message };
      }
      // A kind given before the prompt asked (SR-199) that the source may not have: no target can be taken.
      const kind = answer.output.kinds.find((option) => option.kind === of);
      return kind === undefined
        ? { kind: "failed", message: `The source cannot have a relation of kind ${String(of)}` }
        : elementsOf(kind.targetTypes);
    }
    const answer = await context.call("metamodel.get", {});
    return answer.ok
      ? elementsOf(answer.output.relations.find((kind) => kind.key === of)?.["target-types"])
      : { kind: "failed", message: answer.message };
  },
  // The relations of an element (`relation.remove`): of the element, the kinds of its outgoing relations
  // (relation kinds only, not the properties of kind relation); of a kind, the targets of that kind.
  relation: async ({ context, of, ofSource, before }) => {
    const byKind = ofSource === "relation";
    const element = await elementOf(context, byKind ? before : of);
    if (failed(element)) {
      return element;
    }
    const out = (element?.relations ?? []).filter(
      (relation) => relation.direction === "out" && relation.property !== true,
    );
    if (byKind) {
      return {
        kind: "list",
        values: out
          .filter((relation) => relation.kind === of)
          .map((relation) => ({
            value: relation.id,
            name: refIdTitle(relation),
          })),
      };
    }
    return listOf(await context.call("metamodel.get", {}), (output) =>
      output.relations
        .filter((kind) => out.some((relation) => relation.kind === kind.key))
        .map((kind) => ({ value: kind.key, name: kind.name, key: kind.key })),
    );
  },
  // The hints of the element that can be confirmed (those with a `hintId`), by their target and then
  // their message: the hints of one element differ in their target, which a long message would put out
  // of view (#293). Only the confirmable codes are asked for, on the largest page, so other hints of the
  // element (since a baseline, states) cannot fill the page before them (#146).
  hint: async ({ context, of, taken }) =>
    typeof of === "string"
      ? listOf(
          await context.call("hint.list", {
            ref: of,
            kind: ["relation.outdated", "variant.core-changed"],
            limit: 5000,
          }),
          (output) =>
            output.hints.flatMap((hint) =>
              hint.hintId === undefined || taken.includes(hint.hintId)
                ? []
                : [
                    {
                      value: hint.hintId,
                      name:
                        hint.targetShortId === undefined
                          ? hint.message
                          : `${shownId(hint.targetShortId, hint.targetIdentifier)} · ${hint.message}`,
                    },
                  ],
            ),
        )
      : await asText(),
  // The saved filters of the workspace by name (`filter.list`): "New perspective" `filter`.
  filter: async ({ context }) =>
    listOf(await context.call("filter.list", {}), (output) =>
      output.filters.map((saved) => ({ value: saved.name, name: saved.name })),
    ),
  // The baselines of the workspace by name (`baseline.list`).
  // A name two files share (ignoring case and Unicode normal form, as core finds it) is ambiguous: such a
  // baseline is given by its file name and shows it.
  baseline: async ({ context }) =>
    listOf(await context.call("baseline.list", {}), (output) => {
      const fold = (name: string): string => name.normalize("NFC").toLowerCase();
      const shared = (name: string): boolean =>
        output.baselines.filter((other) => fold(other.name) === fold(name)).length > 1;
      return output.baselines.map((baseline) => {
        const file = baseline.file.slice(baseline.file.lastIndexOf("/") + 1);
        return shared(baseline.name)
          ? { value: file, name: `${baseline.name} · ${file}` }
          : { value: baseline.name, name: baseline.name };
      });
    }),
  // The perspectives of the workspace by name (`perspective.list`, SR-213).
  perspective: async ({ context }) =>
    listOf(await context.call("perspective.list", {}), (output) =>
      output.perspectives.map((perspective) => ({ value: perspective.name, name: perspective.name })),
    ),
  // `core` and the variants of the workspace, as "Choose view" offers them (#285).
  view: async ({ context }) => {
    const views = await viewsOf(context.call);
    return views.ok
      ? { kind: "list", values: views.views.map((shown) => ({ value: shown.view, name: viewName(shown) })) }
      : { kind: "failed", message: views.message };
  },
  // The acceptance criteria of the element (`element.get` `criterionReferences`) that are not taken yet,
  // by number and text with the key beside; the key goes in, since evidence.record refuses a criterion
  // without one, so such a criterion is not offered (catalog `criterion`). Without an element, typed text.
  criterion: async ({ context, of, taken }) => {
    if (typeof of !== "string") {
      return asText();
    }
    return listOf(await context.call("element.get", { ref: of }), (output) =>
      (output.criterionReferences?.criteria ?? []).flatMap(({ criterion, key, text }) =>
        key === undefined || taken.includes(key)
          ? []
          : [
              {
                value: key,
                name: `AK${String(criterion)} ${text.replace(/\s+/gu, " ")}`,
                key,
                label: criterionLabel({ criterion, key }),
              },
            ],
      ),
    );
  },
  // The evidence locations of the workspace file that evidence.record takes (`workspace.status`
  // `evidence[].folder`, in a repository on this machine), with the repository beside; typed text too,
  // for a folder below one.
  evidenceLocation: async ({ context }) => {
    const offer = listOf(await context.call("workspace.status", {}), (output) => {
      const here = new Set(output.repositories.filter((repo) => repo.available).map((repo) => repo.name));
      const seen = new Set<string>();
      return output.evidence.flatMap(({ folder, repository }) => {
        if (folder === undefined || !here.has(repository) || seen.has(folder)) {
          return [];
        }
        seen.add(folder);
        return [{ value: folder, name: folder, key: repository }];
      });
    });
    return offer.kind === "list" ? { ...offer, typed: true } : offer;
  },
  // The file of the element `of` names (`element.get`), or the files of the elements an ambiguous reference
  // names (`details.candidates` of `ref.ambiguous`, the answer of the same read), the repository beside.
  // A reference element.get does not read (a criterion reference of element.resolve): typed text, which
  // core checks.
  elementFile: async ({ context, of, repository }) => {
    const answer = typeof of === "string" ? await context.call("element.get", { ref: of }) : undefined;
    if (answer?.ok === true) {
      return { kind: "list", values: [fileValue(answer.output.element)] };
    }
    // Only those of a repository given in this run: core refuses the others (`ref.unknown`).
    const candidates = (answer?.code === "ref.ambiguous" ? candidatesOf(answer.details) : []).filter(
      (candidate) => typeof repository !== "string" || candidate.repository === repository,
    );
    return candidates.length > 0 ? { kind: "list", values: fileValues(candidates) } : asText();
  },
  // The fields a search can be restricted to (`element.searchFields`, SR-216 AK3) that are not taken
  // yet, and after all properties no single property (AK6), by name with the key beside.
  searchField: async ({ context, taken }) =>
    listOf(await context.call("element.searchFields", {}), (output) =>
      offeredFields(output.fields, taken).map((field) => ({
        value: field.key,
        name: field.name,
        key: field.key,
      })),
    ),
  // The repository, then the path below the folder of the new workspace (`ask`, `askLocationPath`).
  metamodelLocation: ({ of }) =>
    Promise.resolve({ kind: "location", ...(typeof of === "string" ? { base: of } : {}) }),
  // The groupings of the elements the call selects (`group-prompt.ts`).
  group: ({ context, reads }) => offerGroups(context, reads),
  // Built step by step from hits (`askCondition`, `askSort`, `create-prompt.ts`); never asked through their
  // offer. Properties and relations read the type (`FITTING`): their value goes when it is asked again.
  condition: typed(jsonOr),
  sort: typed(jsonOr),
  properties: typed(jsonOr),
  relations: typed(jsonOr),
  // Built in the steps of the metamodel commands (`metamodel-prompt.ts`, SR-236 AK11); never asked through
  // their offer.
  choices: typed(jsonOr),
  choiceChanges: typed(jsonOr),
  limits: typed(jsonOr),
};

/** What the argument at `at` offers, or why its values cannot be read. */
export const offerFor = (
  context: ActionContext,
  entry: Entry,
  at: number,
  arg: Argument,
): Promise<Offer | Failed> => {
  const args = entry.command.arguments;
  const of = contextField(args, at);
  const ofAt = args.findIndex((earlier) => earlier.field === of);
  const before = contextField(args, ofAt);
  const valueOf = (field: string | undefined): unknown =>
    ordered(entry.given).find((given) => given.field === field && given.skipped !== true)?.value;
  const ofSource = args[ofAt]?.complete;
  const reads = groupReads(args, at);
  const input = reads.length === 0 ? {} : inputOf(context, entry);
  return OFFERS[arg.complete]({
    context,
    command: entry.command,
    field: arg.field,
    of: valueOf(of),
    ...(ofSource === undefined ? {} : { ofSource }),
    before: valueOf(before),
    taken: entry.given
      .filter((given) => given.field === arg.field && given.skipped !== true)
      .map((given) => given.value),
    ...(arg.meaning === undefined ? {} : { meaning: arg.meaning }),
    repository: valueOf("repository"),
    reads: Object.fromEntries(reads.flatMap((field) => (field in input ? [[field, input[field]]] : []))),
  });
};
