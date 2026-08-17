import { byteLengthOf, type TokenCount, type TokenEstimator } from "./types.js";

type Encoder = (text: string) => number[];

let encoderPromise: Promise<Encoder> | undefined;

/**
 * The BPE tables are several megabytes, so they load on first use rather than
 * at import time. A CLI that only prints `--version` should never pay for them.
 */
async function loadEncoder(): Promise<Encoder> {
  encoderPromise ??= import("gpt-tokenizer/encoding/cl100k_base").then(
    (module) => module.encode as Encoder,
  );
  return encoderPromise;
}

/**
 * Offline cl100k_base tokenizer.
 *
 * Its output is an *estimate* of what a provider will bill: it is the real
 * cl100k BPE segmentation, but it does not include a provider's message
 * framing, system overhead or model-specific vocabulary. LeanRigor therefore
 * labels it `tokenizer-estimate` and never presents it as provider usage.
 */
export class Cl100kEstimator implements TokenEstimator {
  readonly name = "cl100k";
  readonly version: string;
  readonly mode = "tokenizer-estimate" as const;

  constructor(version = "1") {
    this.version = version;
  }

  async count(text: string): Promise<TokenCount> {
    const encode = await loadEncoder();
    return {
      tokens: text === "" ? 0 : encode(text).length,
      bytes: byteLengthOf(text),
      mode: this.mode,
      estimator: `${this.name}@${this.version}`,
    };
  }
}
