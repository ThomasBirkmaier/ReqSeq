// Entry of a worker thread of the cold load (ADR-0008): serves `serveReads` on the port to the
// thread that started it (`openReadPool`). Loaded anywhere else, it serves nothing: `serveReads`
// checks that `workerData` marks a read worker.
import { parentPort, workerData } from "node:worker_threads";
import { serveReads } from "./read-pool.js";

serveReads(parentPort, workerData);
