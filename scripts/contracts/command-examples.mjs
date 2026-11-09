// The example input of a command page (#1250): schemas/examples/commands/<command>.json matches the input schema
// of that command; `pnpm docs:generate` runs it (packages/docs/src/command-examples.ts).
import fs from "node:fs";
import path from "node:path";
import { commandSchema } from "./load.mjs";

/** The number of valid example files in `dir` and the errors of the others, against `catalog` compiled by `ajv`. */
export function checkCommandExamples(dir, catalog, ajv) {
  const errors = [];
  let count = 0;
  for (const f of fs.readdirSync(dir)) {
    const cmd = catalog.commands.find((c) => `${c.name}.json` === f);
    if (!cmd) {
      errors.push(`examples/commands/${f}: no catalog command ${f.replace(/\.json$/, "")}`);
      continue;
    }
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    } catch (e) {
      errors.push(`examples/commands/${f}: ${e.message}`);
      continue;
    }
    count++;
    const schema = commandSchema(cmd, "input");
    const validate = ajv.getSchema(schema.$id) ?? ajv.compile(schema);
    if (!validate(data)) {
      errors.push(`examples/commands/${f}: ${ajv.errorsText(validate.errors)}`);
    }
  }
  return { count, errors };
}
