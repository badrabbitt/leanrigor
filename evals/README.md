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
| Baseline runs with the skills removed | **Not yet run** — requires model credentials |
| With-skill runs and the resulting uplift comparison | **Not yet run** — requires model credentials |
| Section ablation runs | **Not yet run** — requires model credentials |

The three unrun rows need a model, a host and credentials. Until they have been
run and published, **LeanRigor makes no claim that these skills improve task
outcomes**. They are authored, licensed, provenance-recorded and budget-bounded;
they are not yet evidence-backed.

The release gate in `packages/benchmark` enforces this: a release may not
advertise a quality uplift that no comparison produced.

## Running the model-backed evaluations

```bash
npx leanrigor benchmark --suite skills
```

Record, for every run: model, host, versions, seed where the host supports one,
measurement mode, output hashes and verifier results. A comparison across
different models or hosts is not a comparison.

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
