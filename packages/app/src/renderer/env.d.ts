import type { LogReqBridge } from "../shared/protocol.js";

declare global {
  interface Window {
    /** The preload bridge (ADR-0010). */
    readonly logreq: LogReqBridge;
  }
}
