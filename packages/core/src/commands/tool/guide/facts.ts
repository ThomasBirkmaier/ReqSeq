// What the agent guide takes from the workspace (SR-229 AK2, AK4), found by meaning, never by a type key:
// the types that can be created with the meaning need or requirement (own or inherited), their statuses
// with the initial one (SR-064) and the invalid ones, the relation kinds with the meaning derivation,
// the properties with the meanings acceptance criteria and verification method, and the evidence
// locations of the workspace file. Without a workspace, or with a workspace file or metamodel that cannot
// be read, there are no facts but the reason.
import { CommandError } from "../../../catalog.js";
import { evidenceFolder } from "../../../evidence/index.js";
import type { EffectiveType, Metamodel } from "../../../metamodel/index.js";
import {
  metamodelProblems,
  metamodelState,
  propertyWithMeaning,
  relationKindsWithMeaning,
  typeStatuses,
  typesWithMeaning,
} from "../../../metamodel/index.js";
import { initialStatus } from "../../../model/index.js";
import type { Workspace } from "../../../runtime/workspace.js";
import type { WorkspaceLayout } from "../../../workspace/index.js";
import { workspaceLayoutState } from "../../../workspace/index.js";

/** A definition as the guide names it: its key, which calls take, and its name. */
export interface GuideNamed {
  readonly key: string;
  readonly name: string;
}

export interface GuideStatus extends GuideNamed {
  readonly initial: boolean;
  readonly invalid: boolean;
}

export interface GuideType extends GuideNamed {
  readonly prefix: string;
  readonly statuses: readonly GuideStatus[];
  /** Its key and the keys of its ancestors, which the source and target types of a relation kind name. */
  readonly keys: readonly string[];
  /** The property keys an element of it has. */
  readonly properties: readonly string[];
  /** The property keys it requires, without the title, which every call gives. */
  readonly required: readonly string[];
}

/** A relation kind with the meaning derivation and the types it allows (none named: every type). */
export interface GuideKind extends GuideNamed {
  readonly sources?: readonly string[];
  readonly targets?: readonly string[];
}

/** The facts of a workspace whose metamodel could be read. */
export interface GuideWorkspace {
  readonly needs: readonly GuideType[];
  readonly requirements: readonly GuideType[];
  readonly derivation: readonly GuideKind[];
  /** The property with the meaning `acceptance-criteria`. */
  readonly acceptanceCriteria?: GuideNamed;
  /** The property with the meaning `verification-method`, with its choices. */
  readonly verificationMethod?: GuideNamed & { readonly choices: readonly string[] };
  /** The evidence locations of the workspace file, each as a folder relative to the workspace root, or as written. */
  readonly evidence: readonly string[];
}

/** The facts, or why there are none (SR-229 AK2). */
export type GuideFacts =
  { readonly workspace: GuideWorkspace } | { readonly reason: string; readonly noWorkspace: boolean };

const named = ({ key, name }: GuideNamed): GuideNamed => ({ key, name });

const guideType = (metamodel: Metamodel, type: EffectiveType): GuideType => {
  const initial = initialStatus(metamodel, type);
  const title = propertyWithMeaning(metamodel, "title")?.key;
  return {
    key: type.key,
    name: type.name,
    prefix: type.prefix,
    statuses: typeStatuses(metamodel, type).map((status) => ({
      key: status.key,
      name: status.name,
      initial: status.key === initial,
      invalid: status.invalid === true,
    })),
    keys: [type.key, ...type.ancestors],
    properties: type.properties,
    required: type.required.filter((key) => key !== title),
  };
};

/** The creatable types with the meaning `meaning`, own or inherited, in metamodel order. */
const creatable = (metamodel: Metamodel, meaning: "need" | "requirement"): GuideType[] =>
  typesWithMeaning(metamodel, meaning)
    .filter((type) => !type.abstract)
    .map((type) => guideType(metamodel, type));

/** The evidence locations as `tool.guide` names them: the folder evidence.record takes, else repository and path. */
const evidenceLocations = (layout: WorkspaceLayout): string[] =>
  (layout.file.evidence ?? []).map(
    (location) => evidenceFolder(layout, location) ?? `${location.path} (repository ${location.repository})`,
  );

/** The facts of a workspace whose metamodel is valid. */
export const workspaceFacts = (layout: WorkspaceLayout, metamodel: Metamodel): GuideWorkspace => {
  const criteria = propertyWithMeaning(metamodel, "acceptance-criteria");
  const method = propertyWithMeaning(metamodel, "verification-method");
  return {
    needs: creatable(metamodel, "need"),
    requirements: creatable(metamodel, "requirement"),
    derivation: relationKindsWithMeaning(metamodel, "derivation").map((kind) => ({
      ...named(kind),
      ...(kind["source-types"] === undefined ? {} : { sources: kind["source-types"] }),
      ...(kind["target-types"] === undefined ? {} : { targets: kind["target-types"] }),
    })),
    ...(criteria === undefined ? {} : { acceptanceCriteria: named(criteria) }),
    ...(method === undefined
      ? {}
      : { verificationMethod: { ...named(method), choices: (method.choices ?? []).map((c) => c.key) } }),
    evidence: evidenceLocations(layout),
  };
};

/**
 * Why there are no facts, from an error of reading the workspace, so the guide is there whatever happened.
 * Without a workspace (`workspace.not-found`), `noWorkspace` asks for the call that creates one; a workspace
 * one level below is named by the message (`details.below`), which the guide shows as well.
 */
const reasonOf = (error: unknown): GuideFacts =>
  error instanceof CommandError
    ? { reason: error.message, noWorkspace: error.code === "workspace.not-found" }
    : { reason: `The workspace cannot be read: ${String(error)}`, noWorkspace: false };

/** The reason of a metamodel that is not valid: its first error (SR-011 AK3). */
const metamodelReason = async (workspace: Workspace): Promise<GuideFacts> => {
  const errors = (await metamodelProblems(workspace)).filter((problem) => problem.severity === "error");
  const first = errors.slice(0, 1).map((problem) => problem.message.replace(/\.$/, ""));
  return { reason: `The metamodel of this workspace cannot be read: ${first.join("")}`, noWorkspace: false };
};

/**
 * The facts of `workspace`, from its layout and metamodel only, never from its elements, so the guide is
 * ready at once (the MCP server waits for it before it serves). It never rejects: a `CommandError` of
 * reading them (no workspace file, `workspace.not-found`; one that cannot be read, `file.faulty`) gives its
 * message as the reason, any other error its text, and a metamodel that is not valid its first error.
 */
export const readGuideFacts = async (workspace: Workspace): Promise<GuideFacts> => {
  try {
    const layout = await workspace.get(workspaceLayoutState);
    const metamodel = await workspace.get(metamodelState);
    return metamodel.valid
      ? { workspace: workspaceFacts(layout, metamodel) }
      : await metamodelReason(workspace);
  } catch (error) {
    return reasonOf(error);
  }
};
