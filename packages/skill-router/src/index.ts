export {
  validateSkill,
  discoverSkills,
  collectSkills,
  parseFrontmatter,
  detectCapabilities,
} from "./discover.js";
export type { DiscoveredSkill, CollectOptions } from "./discover.js";
export { parseProvenance } from "./provenance.js";
export { CAPABILITIES, SidecarSchema, ProvenanceSchema, normalizeSidecar } from "./manifest.js";
export type {
  SkillManifest,
  Sidecar,
  Provenance,
  Influence,
  Capability,
} from "./manifest.js";
export { routeSkills } from "./router.js";
export type { RouteOptions, RouteResult, ExcludedSkill, SkillConflict } from "./router.js";
