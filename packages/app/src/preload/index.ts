// Preload of every window (sandboxed, bundled as CommonJS): exposes the bridge and nothing else.
import { contextBridge, ipcRenderer } from "electron";
import { createBridge } from "./bridge.js";

contextBridge.exposeInMainWorld("reqseq", createBridge(ipcRenderer));
