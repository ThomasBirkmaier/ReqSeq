import { describe, expect, it } from "vitest";
import { HOME, addRoute, hashOf, parseHash, renderOf, withFrom } from "./router.js";

describe("parseHash", () => {
  it("reads the parts, decoded, and the parameters", () => {
    const route = parseHash("#/e/SR%2D036?from=%2Fq%2Fdrafts");
    expect(route.parts).toEqual(["e", "SR-036"]);
    expect(route.params.get("from")).toBe("/q/drafts");
    expect(route.hash).toBe("/e/SR%2D036?from=%2Fq%2Fdrafts");
  });

  it("goes home without a route and keeps a part it cannot decode", () => {
    expect(parseHash("").hash).toBe(HOME);
    expect(parseHash("#/").parts).toEqual(["q", "overview"]);
    expect(parseHash("#/e/100%").parts).toEqual(["e", "100%"]);
  });
});

describe("routes", () => {
  it("finds the render an area registered for the first part", async () => {
    const render = (): Promise<void> => Promise.resolve();
    addRoute("test-area", render);
    expect(renderOf(parseHash("#/test-area/x"))).toBe(render);
    expect(renderOf(parseHash("#/unknown"))).toBeUndefined();
    await render();
  });

  it("encodes each part of a hash", () => {
    expect(hashOf("e", "A/B C")).toBe("#/e/A%2FB%20C");
  });
});

describe("the way back", () => {
  it("names a route whose parts hold a slash so that it reads back as the same parts", () => {
    const href = withFrom(hashOf("e", "N-1"), "e", "A/B 1");
    const back = parseHash(parseHash(href).params.get("from") ?? "");
    expect(back.parts).toEqual(["e", "A/B 1"]);
  });
});
