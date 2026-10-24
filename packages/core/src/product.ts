// Name and version of LogReq, embedded from the root package.json by `pnpm contracts:generate`
// (checked by contracts:check), so CLI, API, MCP and app report the same version.
import product from "./generated/product.json" with { type: "json" };

/** Product name, e.g. for the MCP server info. */
export const PRODUCT_NAME: string = product.name;

/** Product version (root package.json), e.g. `logreq --version`. */
export const PRODUCT_VERSION: string = product.version;
