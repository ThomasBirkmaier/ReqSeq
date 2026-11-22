import { describe, expect, it } from "vitest";
import { parseEvents, toServerEvent } from "./events.js";

describe("parseEvents", () => {
  it("gives the complete events and keeps the rest for more text", () => {
    const { events, rest } = parseEvents(
      'event: workspace\ndata: {"generation":1}\n\nevent: change\ndata: {"sc',
    );
    expect(events).toEqual([{ event: "workspace", data: '{"generation":1}' }]);
    expect(rest).toBe('event: change\ndata: {"sc');
  });

  it("joins data lines, skips comments and reads CRLF", () => {
    const { events } = parseEvents(": keep-alive\r\n\r\ndata: a\r\ndata: b\r\n\r\n");
    expect(events).toEqual([{ event: "message", data: "a\nb" }]);
  });
});

describe("toServerEvent", () => {
  it("reads the generation of a workspace event", () => {
    expect(toServerEvent({ event: "workspace", data: '{"generation":3}' })).toEqual({
      type: "workspace",
      generation: 3,
    });
  });

  it("reads the scope and UUIDs of a change, and nothing else", () => {
    expect(
      toServerEvent({ event: "change", data: '{"scope":"elements","elements":["a",1],"text":"x"}' }),
    ).toEqual({
      type: "change",
      scope: "elements",
      elements: ["a"],
    });
    expect(toServerEvent({ event: "change", data: "{}" })).toEqual({
      type: "change",
      scope: "",
      elements: [],
    });
  });

  it("leaves out what it does not know", () => {
    expect(toServerEvent({ event: "workspace", data: "{}" })).toBeUndefined();
    expect(toServerEvent({ event: "other", data: "{}" })).toBeUndefined();
    expect(toServerEvent({ event: "change", data: "not json" })).toBeUndefined();
  });
});
