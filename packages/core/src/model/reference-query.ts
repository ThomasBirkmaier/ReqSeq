// The parts of a `reqseq:` destination that need no model (ADR-0004): its scheme, its query and the repository it
// names. It imports nothing, so the Markdown renderer (`@reqseq/core/markdown`) runs in a browser; `references.ts`
// re-exports it.

export const SCHEME = "reqseq:";

/** The query parameters of a destination, in order, as written; empty ones (`?`, `&&`) are none. */
export const queryOf = (destination: string): string[] => {
  const query = destination.indexOf("?");
  return query < 0
    ? []
    : destination
        .slice(query + 1)
        .split("&")
        .filter((p) => p !== "");
};

/** The value of the first parameter `name` of `params`, undefined when there is none. */
export const queryParam = (params: readonly string[], name: string): string | undefined =>
  params.find((p) => p.startsWith(`${name}=`))?.slice(name.length + 1);

/** The repository a `reqseq:` destination names (`repository=`, as written); an empty one names none. */
export const referenceRepository = (destination: string): string | undefined => {
  const named = queryParam(queryOf(destination), "repository");
  return named === "" ? undefined : named;
};
