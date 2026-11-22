// The opener of the e2e tests (`REQSEQ_SHELL_E2E_OPENER` on macOS and Windows, `xdg-open` in PATH on Linux): it
// appends its arguments as one JSON line to the file `REQSEQ_OPENED` names.
import fs from "node:fs";

fs.appendFileSync(process.env["REQSEQ_OPENED"] ?? "", `${JSON.stringify(process.argv.slice(2))}\n`);
