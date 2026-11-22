import { describe, expect, it } from "vitest";
import type { TokenPlace } from "./token.js";
import { forgetToken, takeToken } from "./token.js";

const place = (
  hash: string,
  kept: Map<string, string> | "refused" = new Map(),
): TokenPlace & { replaced: string[] } => {
  const replaced: string[] = [];
  return {
    replaced,
    location: { hash, pathname: "/", search: "" },
    history: {
      replaceState: (_data: unknown, _unused: string, url?: string | URL | null) =>
        replaced.push(String(url)),
    },
    storage:
      kept === "refused"
        ? undefined
        : {
            getItem: (key) => kept.get(key) ?? null,
            setItem: (key, value) => kept.set(key, value),
            removeItem: (key) => kept.delete(key),
          },
  };
};

describe("takeToken", () => {
  it("takes the token from the fragment, keeps it and removes it from the address", () => {
    const kept = new Map<string, string>();
    const p = place("#token=abc_DEF-1", kept);
    expect(takeToken(p)).toBe("abc_DEF-1");
    expect(kept.get("reqseq.token")).toBe("abc_DEF-1");
    expect(p.replaced).toEqual(["/"]);
    forgetToken(p);
    expect(kept.size).toBe(0);
  });

  it("reads the kept token on a later load, and none where nothing was kept", () => {
    expect(takeToken(place("#/q/overview", new Map([["reqseq.token", "kept"]])))).toBe("kept");
    expect(takeToken(place("#/q/overview"))).toBeUndefined();
  });

  it("holds the token for this page when storage is refused", () => {
    const p = place("#token=only-here", "refused");
    expect(takeToken(p)).toBe("only-here");
    expect(takeToken(place("#/e/SR-1", "refused"))).toBe("only-here");
    forgetToken(p);
    expect(takeToken(place("", "refused"))).toBeUndefined();
  });

  it("takes no token from another fragment", () => {
    expect(takeToken(place("#token=a b"))).toBeUndefined();
  });
});
