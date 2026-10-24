// Test setup for worker threads that core starts (the read pool of a cold load, ADR-0008): Vitest
// runs the TypeScript sources, so a worker loads `packages/*/src/**/*.ts` too. Node strips the
// types itself (`erasableSyntaxOnly`); the hooks map the `.js` specifiers that the sources use (as
// the build emits them) to the `.ts` file next to them. The test configs pass this file with
// `--import` in `execArgv`, and worker threads inherit it. The network stays blocked in workers too.
import { register } from "node:module";
import "./block-network.mjs";

register("./worker-hooks.mjs", import.meta.url);
