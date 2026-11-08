// A site that fails to answer (it never should: `respond` never rejects) still gets the request a response.
import http from "node:http";
import type * as DocsSiteModule from "@reqseq/core/docs-site";
import { docsContentSecurityPolicy } from "@reqseq/core/docs-site";
import { describe, expect, it, vi } from "vitest";
import { DOCS_HOST, startDocsServer } from "./docs-server.js";

vi.mock("@reqseq/core/docs-site", async (original) => ({
  ...(await original<typeof DocsSiteModule>()),
  openDocsSite: () =>
    Promise.resolve({ root: "/site", respond: () => Promise.reject(new Error("read failed at /secret")) }),
}));

describe("startDocsServer", () => {
  it("answers 500 with the CSP when the site rejects, without the error text", async () => {
    const server = await startDocsServer({ folder: "/site" });
    try {
      const answer = await new Promise<{ status: number | undefined; csp: unknown; body: string }>(
        (resolve, reject) => {
          http
            .get({ host: DOCS_HOST, port: server.port, path: "/", agent: false }, (res) => {
              const chunks: Buffer[] = [];
              res.on("data", (chunk: Buffer) => chunks.push(chunk));
              res.on("end", () => {
                resolve({
                  status: res.statusCode,
                  csp: res.headers["content-security-policy"],
                  body: Buffer.concat(chunks).toString("utf8"),
                });
              });
            })
            .on("error", reject);
        },
      );
      expect(answer).toEqual({
        status: 500,
        csp: docsContentSecurityPolicy(),
        body: "Internal error of the documentation server\n",
      });
    } finally {
      await server.close();
    }
  });
});
