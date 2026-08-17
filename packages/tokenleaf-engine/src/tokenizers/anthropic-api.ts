import { LeanRigorError } from "@leanrigor/core";
import { byteLengthOf, type TokenCount, type TokenEstimator } from "./types.js";

/** The only environment variable LeanRigor reads for this credential. */
export const ANTHROPIC_API_KEY_ENV = "LEANRIGOR_ANTHROPIC_API_KEY";

const DEFAULT_ENDPOINT = "https://api.anthropic.com/v1/messages/count_tokens";
const API_VERSION = "2023-06-01";

export interface AnthropicCountApiOptions {
  /** Explicitly supplied credential. LeanRigor never searches files for keys. */
  readonly apiKey: string;
  readonly model: string;
  readonly endpoint?: string;
  readonly fetch?: typeof fetch;
}

/**
 * Counts tokens with Anthropic's official counting endpoint.
 *
 * The result is `provider-count-api`: authoritative for the prompt as sent, but
 * still not the same number as billed response usage, so the two modes stay
 * separate in every report.
 */
export class AnthropicCountApiEstimator implements TokenEstimator {
  readonly name = "anthropic-count-api";
  readonly version = API_VERSION;
  readonly mode = "provider-count-api" as const;

  readonly #apiKey: string;
  readonly #model: string;
  readonly #endpoint: string;
  readonly #fetch: typeof fetch;

  constructor(options: AnthropicCountApiOptions) {
    if (!options.apiKey) {
      throw new LeanRigorError(
        "LR_MEASUREMENT_UNAVAILABLE",
        `the Anthropic count API requires a credential in ${ANTHROPIC_API_KEY_ENV}`,
      );
    }
    if (!options.model) {
      throw new LeanRigorError("LR_MEASUREMENT_UNAVAILABLE", "a model name is required");
    }
    this.#apiKey = options.apiKey;
    this.#model = options.model;
    this.#endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  /**
   * Builds an estimator from the documented environment variable, or returns
   * `null` when it is absent. Nothing else is consulted.
   */
  static fromEnvironment(
    env: Record<string, string | undefined>,
    options: { model: string; endpoint?: string; fetch?: typeof fetch },
  ): AnthropicCountApiEstimator | null {
    const apiKey = env[ANTHROPIC_API_KEY_ENV];
    if (!apiKey) return null;
    return new AnthropicCountApiEstimator({ apiKey, ...options });
  }

  async count(text: string): Promise<TokenCount> {
    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: {
          "x-api-key": this.#apiKey,
          "anthropic-version": API_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.#model,
          messages: [{ role: "user", content: text }],
        }),
      });
    } catch (error) {
      // The cause is deliberately not attached: a fetch error can carry request
      // details, and this error object is rendered to users.
      throw new LeanRigorError(
        "LR_MEASUREMENT_UNAVAILABLE",
        "the Anthropic count API could not be reached",
        { details: { reason: error instanceof Error ? error.name : "unknown" } },
      );
    }

    if (!response.ok) {
      throw new LeanRigorError(
        "LR_MEASUREMENT_UNAVAILABLE",
        `the Anthropic count API returned HTTP ${response.status}`,
        { details: { status: response.status } },
      );
    }

    const body = (await response.json()) as { input_tokens?: number };
    if (typeof body.input_tokens !== "number") {
      throw new LeanRigorError(
        "LR_MEASUREMENT_UNAVAILABLE",
        "the Anthropic count API response contained no input_tokens field",
      );
    }

    return { tokens: body.input_tokens, bytes: byteLengthOf(text), mode: this.mode };
  }
}
