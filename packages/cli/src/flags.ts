/**
 * Minimal flag parsing.
 *
 * A dependency-free parser keeps the CLI's cold start cheap and its behaviour
 * obvious. It supports `--flag`, `--key=value`, `--key value` and `--no-flag`.
 */
export interface ParsedFlags {
  readonly positionals: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
}

export function parseFlags(argv: readonly string[]): ParsedFlags {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const body = token.slice(2);
    if (body === "") continue;

    const equals = body.indexOf("=");
    if (equals >= 0) {
      flags[body.slice(0, equals)] = body.slice(equals + 1);
      continue;
    }

    if (body.startsWith("no-")) {
      flags[body.slice(3)] = false;
      continue;
    }

    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[body] = next;
      index += 1;
    } else {
      flags[body] = true;
    }
  }

  return { positionals, flags };
}

export function flagAsBoolean(value: string | boolean | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  return value !== "false" && value !== "0";
}

export function flagAsList(value: string | boolean | undefined): string[] | undefined {
  if (typeof value !== "string") return undefined;
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
