// For tests: every version as read of a store, by record (`loadedVersionOf` of each of its records).
import type { ElementRecord } from "./elements.js";
import type { LoadedVersion } from "./loaded-version.js";
import type { ElementStore } from "./store.js";
import { loadedVersionOf } from "./store.js";

export const loadedVersionsOf = (store: ElementStore): ReadonlyMap<ElementRecord, LoadedVersion> => {
  const loaded = new Map<ElementRecord, LoadedVersion>();
  for (const record of store.elements) {
    const version = loadedVersionOf(store, record);
    if (version !== undefined) {
      loaded.set(record, version);
    }
  }
  return loaded;
};
