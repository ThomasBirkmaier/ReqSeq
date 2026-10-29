import type { ReqSeqBridge } from "../shared/protocol.js";

declare global {
  interface Window {
    /** The preload bridge (ADR-0010). */
    readonly reqseq: ReqSeqBridge;
  }
}
