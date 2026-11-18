// Fixtures the tests of the CLI output for people share (`present.ts`).

export const lines = (...all: readonly string[]): string => all.map((line) => `${line}\n`).join("");

export const node = (
  id: string,
  shortId: string,
  depth: number,
  direction?: "up" | "down",
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  shortId,
  type: "need",
  title: `Title ${shortId}`,
  status: "draft",
  repository: "system",
  file: `${shortId}.md`,
  depth,
  expanded: true,
  ...(direction === undefined ? {} : { direction }),
  ...extra,
});

/** A derivation from `child` to `parent`, followed in `direction`. */
export const edge = (
  child: string,
  parent: string,
  direction: "up" | "down",
  cyclic = false,
): Record<string, unknown> => ({
  source: child,
  sourceRepository: "system",
  target: parent,
  targetRepository: "system",
  kind: "derives-from",
  direction,
  cyclic,
});
