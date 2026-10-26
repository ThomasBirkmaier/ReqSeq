// The app package (ADR-0010). Electron starts src/main/index.ts (the built out/main/index.js); this entry
// exports the parts that run without Electron, for the cross-access test (SR-080): the core side of the
// IPC and the preload bridge, which tests connect over a Node MessageChannel.
export { createCoreHost } from "./core/host.js";
export type { Channel, CoreHost, CoreHostOptions } from "./core/host.js";
export { createBridge } from "./preload/bridge.js";
export type { IpcRendererLike } from "./preload/bridge.js";
export { WORKSPACE_CHANNEL } from "./shared/protocol.js";
export type * from "./shared/protocol.js";
