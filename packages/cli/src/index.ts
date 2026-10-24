// Command line adapter over the command catalog of @logreq/core (ADR-0002, ADR-0009).
// The binary is bin.ts; runCli and argvFor are exported for in-process callers (the cross-access test, SR-080).
export { argvFor } from "./argv.js";
export { EXIT, EXIT_BY_CLASS, EXIT_BY_CODE, exitCodeFor, runCli } from "./main.js";
export type { ExitCode, RunCliOptions, TextSink } from "./main.js";
export type { InputStream } from "./input.js";
