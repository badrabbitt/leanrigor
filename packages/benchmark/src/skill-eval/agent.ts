import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";

export interface AgentRunInput {
  readonly prompt: string;
  /** Skill body injected as instructions, absent for the baseline condition. */
  readonly instructions?: string;
  readonly workDir: string;
  readonly timeoutMs?: number;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
}

export interface AgentRunOutput {
  /** Agent messages plus the output of every command it ran. */
  readonly transcript: string;
  readonly commands: readonly string[];
  readonly ok: boolean;
  readonly error?: string;
  /** Provider-reported usage, when the CLI emits it. */
  readonly usage?: TokenUsage;
}

export interface EvalAgent {
  readonly name: string;
  readonly model: string;
  run(input: AgentRunInput): Promise<AgentRunOutput>;
}

export interface CodexAgentOptions {
  readonly model?: string;
  /** Isolated CODEX_HOME, so the user's own configuration is never modified. */
  readonly codexHome?: string;
  readonly binary?: string;
  readonly timeoutMs?: number;
}

interface CodexItem {
  readonly type?: string;
  readonly text?: string;
  readonly command?: string;
  readonly aggregated_output?: string;
  readonly exit_code?: number | null;
  readonly status?: string;
}

interface CodexEvent {
  readonly type?: string;
  readonly item?: CodexItem;
  readonly usage?: {
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
  };
  readonly error?: unknown;
}

export interface ParsedStream {
  readonly transcript: string;
  readonly commands: string[];
  readonly usage?: TokenUsage;
  readonly providerError: boolean;
}

/**
 * Parses the Codex JSON event stream.
 *
 * Command output is folded into the transcript deliberately: a check like
 * `transcript-contains-command-output` is asking whether the agent's claim rests
 * on real output, and that output only exists in the command events.
 */
export function parseCodexStream(stdout: string): ParsedStream {
  const parts: string[] = [];
  const commands: string[] = [];
  let usage: TokenUsage | undefined;
  let providerError = false;

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    if (!trimmed.startsWith("{")) {
      // Non-JSON noise, including the provider's plain-text error lines.
      if (/"type"\s*:\s*"(invalid_request_error|error)"/.test(trimmed)) providerError = true;
      continue;
    }

    let event: CodexEvent;
    try {
      event = JSON.parse(trimmed) as CodexEvent;
    } catch {
      continue;
    }

    if (event.type === "error" || event.error !== undefined) providerError = true;

    if (event.type === "turn.completed" && event.usage) {
      usage = {
        inputTokens: event.usage.input_tokens ?? 0,
        cachedInputTokens: event.usage.cached_input_tokens ?? 0,
        outputTokens: event.usage.output_tokens ?? 0,
      };
    }

    const item = event.item;
    if (!item || event.type !== "item.completed") continue;

    if (item.type === "agent_message" && item.text) parts.push(item.text);

    if (item.type === "command_execution" && item.command) {
      commands.push(item.command);
      const output = item.aggregated_output ?? "";
      parts.push(
        `$ ${item.command}\n${output}${
          item.exit_code === null || item.exit_code === undefined
            ? ""
            : `\nexit code ${item.exit_code}`
        }`,
      );
    }
  }

  return { transcript: parts.join("\n\n"), commands, ...(usage ? { usage } : {}), providerError };
}

/**
 * Drives the Codex CLI headlessly.
 *
 * `--ignore-user-config` keeps runs reproducible and keeps the user's own
 * settings out of the measurement; auth still comes from the isolated
 * `CODEX_HOME`, which is a symlink to the real credential rather than a copy.
 */
export class CodexAgent implements EvalAgent {
  readonly name = "codex";
  readonly model: string;
  readonly #codexHome: string | undefined;
  readonly #binary: string;
  readonly #timeoutMs: number;

  constructor(options: CodexAgentOptions = {}) {
    this.model = options.model ?? "gpt-5.5";
    this.#codexHome = options.codexHome;
    this.#binary = options.binary ?? "codex";
    this.#timeoutMs = options.timeoutMs ?? 300_000;
  }

  async run(input: AgentRunInput): Promise<AgentRunOutput> {
    await mkdir(input.workDir, { recursive: true });

    const prompt = input.instructions
      ? `${input.instructions}\n\n---\n\n${input.prompt}`
      : input.prompt;

    const args = [
      "exec",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--json",
      "-m",
      this.model,
      "-s",
      "workspace-write",
      "-C",
      input.workDir,
      prompt,
    ];

    return new Promise<AgentRunOutput>((resolve) => {
      const child = spawn(this.#binary, args, {
        cwd: input.workDir,
        env: {
          ...process.env,
          ...(this.#codexHome ? { CODEX_HOME: this.#codexHome } : {}),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, input.timeoutMs ?? this.#timeoutMs);

      child.on("close", () => {
        clearTimeout(timer);
        const parsed = parseCodexStream(stdout);
        const failed =
          parsed.providerError
          || timedOut
          || parsed.transcript.trim() === ""
          || /"type"\s*:\s*"invalid_request_error"/.test(stderr);

        resolve({
          transcript: parsed.transcript,
          commands: parsed.commands,
          ...(parsed.usage ? { usage: parsed.usage } : {}),
          ok: !failed,
          ...(failed
            ? { error: timedOut ? "timed out" : "provider rejected the request" }
            : {}),
        });
      });
    });
  }
}
