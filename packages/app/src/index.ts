// The app package (ADR-0010). Electron starts src/main/index.ts (the built out/main/index.js); this entry
// exports the parts that run without Electron, for the cross-access test (SR-080): the core side of the
// IPC and the preload bridge, which tests connect over a Node MessageChannel; and for the documentation generator,
// how the app offers each command.
export { createCoreHost } from "./core/host.js";
export type { Channel, CoreHost, CoreHostOptions } from "./core/host.js";
export { createBridge } from "./preload/bridge.js";
export type { IpcRendererLike } from "./preload/bridge.js";
export { SAVE_CHANNEL, WORKSPACE_CHANNEL } from "./shared/protocol.js";
export type * from "./shared/protocol.js";
// How the app offers each catalog command, for the documentation generator (ADR-0017).
export { appCommandEntry, commandPromptKey } from "./renderer/command-entry.js";
export type { AppCommandEntry, NamedCommand } from "./renderer/command-entry.js";
// Every key of the app with what it does, for the keyboard reference (SR-139 AK5).
export { SHORTCUT_TABLES, shortcutReference } from "./renderer/shortcut-reference.js";
export type { ShortcutRow, ShortcutSection, ShortcutTables } from "./renderer/shortcut-reference.js";
