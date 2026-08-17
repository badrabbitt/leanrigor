export { ResultStore } from "./store.js";
export type {
  ResultStoreOptions,
  PutMetadata,
  StoredRecord,
  ByteRange,
} from "./store.js";
export { handleFor, assertHandle, hashOf, HANDLE_PREFIX } from "./handle.js";
export { DEFAULT_RETENTION, planEviction } from "./retention.js";
export type { RetentionPolicy, GcResult, RetainedItem } from "./retention.js";
