# Environmental methodology

LeanRigor can report an estimated energy range for inference work it helped
avoid. This document states exactly what that number is, what it is not, and how
it is produced — so a reader can check it rather than trust it.

**It is disabled by default.** You have to turn it on.

## What LeanRigor can and cannot observe

| Quantity | Status |
|---|---|
| Bytes before and after LeanRigor's own transformations | **Measured directly** |
| Tokens, via a named local tokenizer | **Estimated**, labelled `tokenizer-estimate` |
| Tokens, via a provider's counting endpoint | **Provider-reported**, labelled `provider-count-api` |
| Tokens, from a provider SDK response | **Provider-reported**, labelled `provider-usage` |
| Energy used by a provider's hardware | **Not observable.** Estimated from published ranges |
| Carbon emitted | **Not observable.** Computed only from a grid intensity you supply |

LeanRigor has no visibility into provider hardware, batch sizes, utilization,
cooling or grid mix. Anything downstream of that is an estimate with a range,
and is labelled as one.

## The model

Energy is estimated separately for the two phases of inference, because they
have different costs per token and averaging them hides that output dominates:

```text
estimated_energy_range
  = (prefill_estimate + decode_estimate) × infrastructure_overhead_range
```

- **prefill** — input tokens × a published Wh-per-thousand-token range for the
  model class. Cache-read tokens are charged a fraction of that, never zero.
- **decode** — output tokens × a published Wh-per-thousand-token range, which is
  roughly an order of magnitude higher than prefill.
- **infrastructure overhead** — a multiplier covering power usage
  effectiveness, networking and idle capacity.

Every coefficient lives in
[`packages/energy-estimator/data/methodology-v1.json`](../packages/energy-estimator/data/methodology-v1.json)
with its source, URL and retrieval date. The code contains no unexplained
constants; a constant with no citation is a claim nobody can check.

## Unknowns widen the range

If you do not tell LeanRigor the model class, the range spans every class in the
methodology. It will not collapse to a confident midpoint. The width of the
range *is* the honest content of the estimate; the midpoint is a display
convenience, not a best guess.

## Carbon

No carbon figure is produced unless you supply a grid intensity in gCO2e/kWh.
LeanRigor will not assume a grid it cannot see. When you supply one, the output
attributes it to you.

## What LeanRigor will never say

These strings are rejected by tests over every user-visible label the estimator
emits (`packages/energy-estimator/test/estimate.test.ts`):

- "exact CO2" / "exact carbon"
- "trees saved" / "trees planted"
- "bottles of water"
- "datacenter measured" / "measured in the datacenter"
- "actual energy used" / "actual emissions"

Equivalences of the tree-and-water-bottle kind are excluded because reproducing
them would require peer-reviewed, reproducible assumptions that do not exist for
this workload.

## Token reduction is not an energy proxy

The literature is explicit that compressing a prompt can *increase* total energy
by lengthening the output or causing a retry
([The Compression Paradox in LLM Inference](https://arxiv.org/abs/2603.23528)).
LeanRigor therefore never converts "tokens avoided" directly into "energy
saved". Savings from a task that failed its verifier are excluded from every
total, for the same reason: work that had to be redone was not saved.

## Sources

| Source | Used for |
|---|---|
| [From Tokens to Watt-hours](https://arxiv.org/abs/2607.26571) | separating prefill from decode; exposing hardware assumptions |
| [Energy Use of AI Inference](https://arxiv.org/abs/2509.20241) | bottom-up estimates need throughput, utilization and PUE assumptions |
| [The Compression Paradox in LLM Inference](https://arxiv.org/abs/2603.23528) | token reduction is not a reliable energy proxy |
| [Towards Green AI for Software Development](https://arxiv.org/abs/2602.05712) | prefill volume affects decoding energy |
| [Green Software Foundation — SCI](https://github.com/Green-Software-Foundation/sci) | functional unit, disclosure, grid intensity as an input |

## Versioning

The methodology is versioned. Changing a coefficient means a new version file
and a new version string in the output, so two reports produced months apart can
be compared — or correctly refused as incomparable.
