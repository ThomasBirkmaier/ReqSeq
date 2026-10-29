// Runs the Astro command line with its telemetry and its update check off (ADR-0017: the docs tooling opens no
// connections of its own). Called as `node packages/docs/site/run.mjs build|dev`, so it works the same on every system.
import { spawnSync } from "node:child_process";
import { URL, fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const astro = fileURLToPath(new URL("node_modules/astro/bin/astro.mjs", import.meta.url));
const result = spawnSync(process.execPath, [astro, ...process.argv.slice(2), "--root", root], {
  stdio: "inherit",
  env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1", ASTRO_DISABLE_UPDATE_CHECK: "true" },
});
process.exit(result.status ?? 1);
