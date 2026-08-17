# Evaluations

## What is here

`evals/skills/*.yaml` holds the evaluation cases for the three skills LeanRigor
ships. Each file declares:

- **positive cases** — the skill should load and change the outcome;
- **non-trigger cases** — the skill should *not* load, so a bounded trigger
  description is tested as directly as the skill body;
- **deterministic checks** — assertions over the transcript and the artifacts
  produced. No check asks a model to judge another model's prose.
- **ablation sections** — the sections removed one at a time to find which
  instructions actually earn their context.

## What has been run, and what has not

This distinction is the point of the project, so it is stated plainly.

| Check | Status |
|---|---|
| Skills validate against the router (metadata, license, provenance, budget) | **Run**, in CI, `packages/skill-router/test/shipped-skills.test.ts` |
| Every skill fits its declared context budget | **Run**, in CI |
| Routing selects the right skills per risk level, with no conflicts | **Run**, in CI |
| Eval files are well-formed, complete and name real skill sections | **Run**, in CI |
| Baseline runs with the skills removed | **Run**, 2026-08-18, Codex CLI with `gpt-5.5` |
| With-skill runs and the resulting uplift comparison | **Run** — see [docs/benchmarks/skill-eval.md](../docs/benchmarks/skill-eval.md) |
| Repetitions for `senior-system-design` and `product-brainstorming` | **Not yet run** — both results are n=1 |
| Section ablation runs | **Not yet run** — no section has been shown to earn its context |
| A second agent or model | **Not yet run** — every number is one CLI, one model |

Measured uplift: `senior-system-design` +66.7 points, `product-brainstorming`
+80.0 points (both n=1), `verification` +10.0 points (n=4). All three trigger
descriptions are bounded: the router selected none of them on any non-trigger
prompt.

**Read the caveats before quoting those numbers.** Running the `verification`
suite three times on an identical configuration produced +40, +20 and −20
points. A 60-point swing on an unchanged setup means anything below roughly
twenty points at n=1 is indistinguishable from noise, and the two large results
above are single runs. The report prints a warning whenever n < 2.

The release gate in `packages/benchmark` enforces the same discipline: a release
may not advertise a quality uplift that no comparison produced.

## Running the model-backed evaluations

```bash
npx leanrigor benchmark --suite skills
npx leanrigor benchmark --suite skills --skill verification --repeat 4
npx leanrigor benchmark --suite skills --ablation
```

The runner drives the Codex CLI headlessly with an isolated `CODEX_HOME`, so the
user's own configuration is never read or modified.

Record, for every run: model, host, versions, seed where the host supports one,
measurement mode, output hashes and verifier results. A comparison across
different models or hosts is not a comparison.

**Baseline fairness.** Where a case's checks require a file, the baseline is told
to write that file and nothing about its contents. Without that, the comparison
measures which condition was told to produce an artifact:
`senior-system-design` scored +100 points before the neutralisation and +66.7
after it.

## Check vocabulary

| Kind | Asserts |
|---|---|
| `ran-command` | a command matching the pattern was executed |
| `transcript-contains-command-output` | real output was quoted, not paraphrased |
| `transcript-matches` / `transcript-not-matches` | the transcript does or does not match a pattern |
| `artifact-exists` | the named file was produced |
| `artifact-has-sections` | the artifact contains every named section |
| `artifact-matches` / `artifact-section-matches` | pattern match over an artifact or one section |
| `artifact-section-list-min` | a section lists at least N items |
| `skill-not-loaded` | the router did not select the skill |
