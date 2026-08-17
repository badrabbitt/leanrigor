export {
  runCli,
  COMMANDS,
  TAGLINE,
  EXIT_OK,
  EXIT_FAILURE,
  EXIT_UNAVAILABLE,
} from "./cli.js";
export type { CliIo, CommandSpec } from "./cli.js";
export { parseFlags, flagAsBoolean, flagAsList } from "./flags.js";
export { runInit, runUninstall, buildAdapters } from "./commands/init.js";
export { runDoctor, collectChecks } from "./commands/doctor.js";
export type { Check, CheckStatus, DoctorOptions } from "./commands/doctor.js";
export type { InitOptions } from "./commands/init.js";
export { runTelemetry, readState, buildPendingPayload, sendIfEnabled } from "./commands/telemetry.js";
export type { TelemetryState, TelemetryOptions, PendingPayload } from "./commands/telemetry.js";
export { runBenchmark } from "./commands/benchmark.js";
export type { BenchmarkOptions } from "./commands/benchmark.js";
export { runReport, toShareCard } from "./commands/report.js";
export type { ReportOptions } from "./commands/report.js";
export { renderReport } from "./render/terminal.js";
export type { ReportView, GateCoverage } from "./render/terminal.js";
export { renderShareCard, escapeXml } from "./render/share-svg.js";
export type { ShareCard } from "./render/share-svg.js";
export { runMcpServe, loadConfig } from "./commands/mcp.js";
export type { McpOptions } from "./commands/mcp.js";
export { runSkills, runSkillsList, runSkillsInstall, runSkillsValidate } from "./commands/skills.js";
export type { SkillsOptions } from "./commands/skills.js";
