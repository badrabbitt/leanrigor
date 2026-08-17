# Measurement boundaries

What LeanRigor measures, what it estimates, and what it cannot see. This is the
document to check a claim against.

## The four measurement modes

Every token figure carries one of these labels, and figures with different
labels are never added together into an unlabelled total.

| Mode | Source | Is it a measurement? |
|---|---|---|
| `provider-usage` | usage fields in a provider SDK response | Yes, by the provider |
| `provider-count-api` | an official pre-request counting endpoint | Yes, by the provider |
| `tokenizer-estimate` | a local tokenizer, named and versioned | **No — an estimate** |
| `byte-only` | no token measurement was possible | No token figure at all |

`byte-only` deliberately reports *no* token count. A bytes-per-token constant
would look like a measurement while being a guess, and every downstream report
would inherit that false precision.

## What is measured directly

Serialized bytes before and after LeanRigor's own transformations. This is the
one thing LeanRigor can observe exactly, and it is the basis of the benchmark.

## What is estimated

**Tokens**, when no provider count is available. The offline estimator runs the
real cl100k BPE segmentation, so it is a good estimate — but it does not include
a provider's message framing, system overhead or model-specific vocabulary. It
is labelled `tokenizer-estimate` and never presented as provider usage.

**Energy**, always. See
[environmental-methodology.md](environmental-methodology.md).

## What LeanRigor cannot see

- Tokens in parts of the session it did not handle.
- Hidden reasoning tokens.
- Provider-side caching, batching or retries.
- Provider hardware, utilization, cooling or grid mix.
- Whether a task would have succeeded without LeanRigor, except by running the
  baseline condition and comparing.

## Coverage

"Coverage: payloads handled by LeanRigor only" appears on every report and means
exactly that. If your session sends 100k tokens of conversation and 10k tokens of
tool results, LeanRigor's figures describe the 10k. It does not claim, and cannot
compute, a percentage of your whole session.

## What counts as a saving

A saving is counted only when **both** are true:

1. the task passed its deterministic verifier, and
2. every mandatory Rigor Gate produced evidence.

An event with no verdict is not counted. A missing verdict is never treated as
optimistic.

Reports show two totals side by side: a gross figure covering every event, and a
quality-adjusted figure covering only counted events. A large gap between them is
information, not something to hide.

## Expansions are reported as negative

Some optimizations make a payload larger. Those are recorded as negative savings
and shown as such. Clamping them to zero would make the total a best case rather
than a result.

## Comparisons

Two runs are compared by pairing cases on their id. Cases present in only one run
are excluded and listed, because comparing ten cases against six produces a
number that looks like a result and is not one. Pairs whose measurement modes
differ are rejected outright — subtracting an estimate from provider-reported
usage is arithmetic on incompatible units.

## The release gate

A release may ship and still be forbidden from advertising savings. The two
verdicts are computed separately:

| Check | Blocks the release | Blocks a savings claim |
|---|---|---|
| Pass-rate delta ≥ −2 points | yes | yes |
| No open critical privacy or provenance violation | yes | yes |
| MCP conformance passed | yes | yes |
| ≥ 90% of cases completed | no | yes |
| Median context reduction ≥ 40% | no | yes |

## Language rules

Allowed:

- "Estimated tool-context tokens avoided"
- "Potential inference work avoided"
- "Energy estimate based on published assumptions"

Never used, and enforced by tests:

- "exact CO2 saved", "exact carbon"
- "trees saved", "bottles of water"
- "datacenter measured", "actual energy used"
- "actual tokens", "actual usage" for anything a provider did not report

## Where to check these claims

| Claim | Enforced in |
|---|---|
| No payload can reach the ledger | `packages/core/src/measurement.ts`, `packages/core/test/measurement.test.ts` |
| Failed work is excluded from savings | `packages/tokenleaf-engine/test/report.test.ts` |
| Mixed modes are never summed | `packages/tokenleaf-engine/src/report.ts` |
| Estimates are never called actual usage | `packages/cli/test/report.test.ts` |
| Forbidden environmental phrases | `packages/energy-estimator/test/estimate.test.ts` |
| The release gate's arithmetic | `packages/benchmark/test/release-gate.test.ts` |
| Share cards carry no identifying data | `packages/cli/test/share-svg.test.ts` |
