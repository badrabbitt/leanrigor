export type {
  LossPolicy,
  Projector,
  ProjectionInput,
  ProjectionBudget,
  ProjectionResult,
} from "./types.js";
export { byteLength, withinBudget } from "./types.js";
export { JsonProjector } from "./json.js";
export { LogProjector, normalizeLine } from "./log.js";
export { TextProjector } from "./text.js";
export { DiffProjector, unifiedDiff } from "./diff.js";
export type { DiffOptions } from "./diff.js";
