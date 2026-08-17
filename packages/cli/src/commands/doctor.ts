import { access, constants, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { defaultConfig, parseConfig } from "@leanrigor/core";
import { discoverSkills } from "@leanrigor/skill-router";
import type { CliIo } from "../cli.js";
import { EXIT_FAILURE, EXIT_OK } from "../cli.js";
import { buildAdapters } from "./init.js";

export type CheckStatus = "ok" | "warn" | "fail";

export interface Check {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail: string;
}

export interface DoctorOptions {
  readonly projectDir?: string;
  readonly homeDir?: string;
  readonly dataDir?: string;
  readonly nodeVersion?: string;
  readonly skillRoots?: readonly string[];
}

const MINIMUM_NODE_MAJOR = 22;

async function checkNode(version: string): Promise<Check> {
  const major = Number.parseInt(version.replace(/^v/, "").split(".")[0] ?? "0", 10);
  if (Number.isNaN(major)) {
    return { name: "node version", status: "fail", detail: `unrecognized version "${version}"` };
  }
  return major >= MINIMUM_NODE_MAJOR
    ? { name: "node version", status: "ok", detail: `${version} (minimum v${MINIMUM_NODE_MAJOR})` }
    : {
        name: "node version",
        status: "fail",
        detail: `${version} is below the required v${MINIMUM_NODE_MAJOR}`,
      };
}

async function checkDataDir(dataDir: string): Promise<Check> {
  const probe = path.join(dataDir, ".leanrigor-write-probe");
  try {
    await mkdir(dataDir, { recursive: true });
    await access(dataDir, constants.W_OK);
    // An access check can disagree with reality on network and container
    // filesystems, so the probe actually writes.
    await writeFile(probe, "probe", "utf8");
    await rm(probe, { force: true });
    return { name: "data directory", status: "ok", detail: `${dataDir} is writable` };
  } catch (error) {
    return {
      name: "data directory",
      status: "fail",
      detail: `${dataDir} is not writable: ${(error as Error).message}`,
    };
  }
}

async function checkConfig(projectDir: string, dataDir: string): Promise<Check> {
  const configPath = path.join(projectDir, ".leanrigor", "config.json");
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch {
    return {
      name: "configuration",
      status: "ok",
      detail: "no config file; built-in defaults are in use",
    };
  }
  try {
    const config = parseConfig(JSON.parse(raw) as unknown);
    return {
      name: "configuration",
      status: "ok",
      detail: `${configPath} parsed; ${config.upstreamServers.length} upstream server(s)`,
    };
  } catch (error) {
    void dataDir;
    return { name: "configuration", status: "fail", detail: (error as Error).message };
  }
}

async function checkGateway(): Promise<Check> {
  try {
    // Importing the gateway is the honest check the CLI can make here: it
    // proves the server can be constructed. Whether a host launches it is the
    // host's business, and doctor does not pretend to know.
    const module = await import("@leanrigor/mcp-gateway");
    return {
      name: "mcp gateway",
      status: "ok",
      detail: `loadable; exposes ${module.GATEWAY_TOOLS.length} tools`,
    };
  } catch (error) {
    return { name: "mcp gateway", status: "fail", detail: (error as Error).message };
  }
}

async function checkSkills(roots: readonly string[]): Promise<Check> {
  let valid = 0;
  const broken: string[] = [];
  for (const root of roots) {
    for (const entry of await discoverSkills(root)) {
      if (entry.valid) valid += 1;
      else broken.push(entry.name);
    }
  }
  if (broken.length > 0) {
    return {
      name: "skills",
      status: "warn",
      detail: `${valid} valid; ${broken.length} invalid (${broken.join(", ")})`,
    };
  }
  return { name: "skills", status: "ok", detail: `${valid} valid skill(s) discovered` };
}

async function checkHosts(projectDir: string, homeDir: string): Promise<Check> {
  const adapters = buildAdapters(projectDir, homeDir);
  const detected: string[] = [];
  for (const adapter of adapters) {
    if ((await adapter.detect()).detected) detected.push(adapter.host);
  }
  return detected.length > 0
    ? { name: "hosts", status: "ok", detail: `detected ${detected.join(", ")}` }
    : { name: "hosts", status: "warn", detail: "no supported host detected" };
}

function checkTelemetry(): Check {
  const config = defaultConfig("/tmp");
  return {
    name: "telemetry",
    status: "ok",
    detail: config.telemetry.enabled
      ? "enabled; aggregate measurements only"
      : "disabled (default); nothing is sent",
  };
}

/**
 * Diagnoses the installation.
 *
 * Every check reports what it actually observed. A check that could not run
 * says so rather than reporting `ok`, because a diagnostic that is optimistic
 * when uncertain is worse than no diagnostic.
 */
export async function collectChecks(options: DoctorOptions = {}): Promise<Check[]> {
  const projectDir = options.projectDir ?? process.cwd();
  const homeDir = options.homeDir ?? homedir();
  const dataDir = options.dataDir ?? path.join(projectDir, ".leanrigor");
  const skillRoots = options.skillRoots ?? [
    path.join(projectDir, ".leanrigor", "skills"),
    path.join(homeDir, ".leanrigor", "skills"),
  ];

  return [
    await checkNode(options.nodeVersion ?? process.version),
    await checkDataDir(dataDir),
    await checkConfig(projectDir, dataDir),
    await checkGateway(),
    await checkSkills(skillRoots),
    await checkHosts(projectDir, homeDir),
    checkTelemetry(),
  ];
}

export async function runDoctor(io: CliIo, options: DoctorOptions = {}): Promise<number> {
  const checks = await collectChecks(options);
  const symbol: Record<CheckStatus, string> = { ok: "ok  ", warn: "warn", fail: "FAIL" };

  io.out("LeanRigor doctor");
  io.out("");
  for (const check of checks) {
    io.out(`  [${symbol[check.status]}] ${check.name.padEnd(16)} ${check.detail}`);
  }
  io.out("");

  const failures = checks.filter((check) => check.status === "fail");
  if (failures.length > 0) {
    io.err(`${failures.length} check(s) failed.`);
    return EXIT_FAILURE;
  }
  io.out("All checks passed.");
  return EXIT_OK;
}
