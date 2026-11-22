// The names the element walk skips or that Windows changes, wherever a repository is checked out. It imports only
// an import-free module, so the Markdown renderer (`@reqseq/core/markdown`) runs in a browser; `discover.ts`
// re-exports it.
import { systemForm } from "../files/system-form.js";

/** Never read: Git's own folder (or the `.git` file of a submodule) and installed packages (workspace.schema.json). */
export const SKIPPED_NAMES: ReadonlySet<string> = new Set([".git", "node_modules"]);

/** Names Windows reserves for devices, with or without an extension (`NUL`, `com1.md`, `CONIN$`). */
const DEVICE_NAME = /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/iu;

/** Characters Windows refuses in a name, besides the control characters. */
const WINDOWS_REFUSED = /[<>:"|?*]/;

/**
 * Whether Windows or macOS take `name` for `.git` or `node_modules` (any case, trailing dots and
 * spaces dropped).
 */
export const isSkippedOnSomeSystem = (name: string): boolean => SKIPPED_NAMES.has(systemForm(name));

/**
 * Whether Windows changes or refuses `name`: a trailing dot or space, one of `<>:"|?*`, a control
 * character or a device name (`NUL`, `com1.png`).
 */
export const windowsChanges = (name: string): boolean =>
  /\p{Cc}/u.test(name) || /[. ]$/.test(name) || WINDOWS_REFUSED.test(name) || DEVICE_NAME.test(name);
