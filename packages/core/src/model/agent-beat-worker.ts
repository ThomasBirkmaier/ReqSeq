// Entry of the heartbeat thread of an agent connection (SR-228): serves `serveBeat` on the port to
// the thread that started it (model/agents.ts). Loaded anywhere else, it serves nothing:
// `serveBeat` checks that `workerData` marks a beat worker.
import { parentPort, workerData } from "node:worker_threads";
import { serveBeat } from "./agent-beat.js";

serveBeat(parentPort, workerData);
