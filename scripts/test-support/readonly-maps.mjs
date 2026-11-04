// Test setup: a read-only map of another class than `Map` (core's `PatchedMap`, #215) equals a
// `Map` with the same entries in `toEqual`, as two `Map`s do (in any key order). Vitest otherwise
// compares iterables by their constructor first, so a store patched by the watcher would not equal
// a full read. Both must read as maps (`Object.prototype.toString`).
import { expect } from "vitest";

const isMap = (value) => Object.prototype.toString.call(value) === "[object Map]";

expect.addEqualityTesters([
  function readonlyMaps(a, b, testers) {
    if (!isMap(a) || !isMap(b) || a.constructor === b.constructor) {
      return undefined;
    }
    if (a.size !== b.size) {
      return false;
    }
    for (const [key, value] of a) {
      if (!b.has(key) || !this.equals(value, b.get(key), testers)) {
        return false;
      }
    }
    return true;
  },
]);
