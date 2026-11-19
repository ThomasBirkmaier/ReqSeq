// Which SVG images the HTML export copies (SR-235 AK4): none that could run or load anything when opened.
import { describe, expect, it } from "vitest";
import { svgRisk } from "./svg.js";

const svg = (inner: string): Uint8Array =>
  new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${inner}</svg>`,
  );

describe("svgRisk", () => {
  it("takes a drawing with internal references only", () => {
    expect(
      svgRisk(svg('<defs><g id="a"/></defs><use xlink:href="#a"/><rect fill="url(#g)"/>')),
    ).toBeUndefined();
  });

  it.each([
    ["a script", "<script>alert(1)</script>", "a script or embedded content"],
    ["a foreign object", "<foreignObject><div/></foreignObject>", "a script or embedded content"],
    ["an entity", '<!ENTITY x "y">', "a script or embedded content"],
    ["an event attribute", '<rect onload="f()"/>', "an event attribute"],
    [
      "an animation that sets an address",
      '<a><animate attributeName="href" to="&#106;avascript:f()"/></a>',
      "an animation or a character reference",
    ],
    ["a set element", '<a><set attributeName="href" to="#x"/></a>', "an animation or a character reference"],
    ["a character reference", "<text>&#x41;</text>", "an animation or a character reference"],
    ["a script address", '<a href="javascript:f()"/>', "a script or data address"],
    ["a data address", '<image href="data:image/png;base64,AA"/>', "a script or data address"],
    ["an outside image", '<image href="https://example.org/x.png"/>', "a reference outside the file"],
    ["an outside style", '<rect style="fill: url(https://e.org/p)"/>', "a reference outside the file"],
    ["an import", "<style>@import 'x.css';</style>", "a reference outside the file"],
  ])("refuses %s", (_name, inner, risk) => {
    expect(svgRisk(svg(inner))).toBe(risk);
  });
});
