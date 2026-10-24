import { describe, expect, it } from "vitest";
import net from "node:net";
import http from "node:http";

// The guard itself (ADR-0011): outgoing connections fail, loopback works.
describe("network guard", () => {
  it("blocks net.connect to an IP literal", () => {
    expect(() => net.connect({ host: "192.0.2.1", port: 80 })).toThrow(/blocked/);
    expect(() => net.connect(80, "192.0.2.1")).toThrow(/blocked/);
  });

  it("blocks fetch and http to an IP literal", async () => {
    await expect(fetch("http://192.0.2.1/")).rejects.toThrow();
    expect(() => http.get("http://192.0.2.1/")).toThrow(/blocked/);
  });

  it("allows loopback", async () => {
    const server = net.createServer((s) => s.end());
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address();
    await new Promise((resolve, reject) => {
      const s = net.connect({ host: "127.0.0.1", port }, () => {
        s.destroy();
        resolve();
      });
      s.on("error", reject);
    });
    server.close();
  });
});
