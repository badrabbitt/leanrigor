# Skill evaluation results

**Date:** 2026-08-18
**Agent:** Codex CLI, model `gpt-5.5`
**Command:** `npx leanrigor benchmark --suite skills`
**Raw results:** `skill-eval-run3.json`, `skill-eval-run4.json`, `skill-eval-verification-n4.json`

These are the model-backed runs `evals/README.md` previously listed as
outstanding. Read the caveats before quoting any number.

## Headline

| Skill | Baseline | With skill | Uplift | Reps | Non-trigger |
|---|---|---|---|---|---|
| senior-system-design | 2/6 | 6/6 | **+66.7 points** | 1 | 3/3 |
| product-brainstorming | 0/5 | 4/5 | **+80.0 points** | 1 | 3/3 |
| verification | 16/20 | 18/20 | **+10.0 points** | 4 | 3/3 |

Every skill's trigger description is bounded: across all three, the router
selected none of them on any of the nine non-trigger prompts.

## Caveat that matters more than the headline

**One run per cell is not a measurement.** The `verification` suite was run three
times with an identical configuration and produced **+40, +20 and −20 points**.
A 60-point swing on an unchanged setup means anything below roughly twenty
points at n=1 is indistinguishable from noise.

The two single-repetition rows above are therefore *indicative, not settled*.
They are large — 67 and 80 points — which is why they survive as signals at all.
The runner now supports `--repeat`, and the report prints a warning whenever
n < 2.

## What the n=4 run actually shows

`verification` was re-run with four repetitions, twenty runs per condition:

| Repetition | Baseline | With skill | Uplift |
|---|---|---|---|
| 0 | 4/5 | 4/5 | +0.0 |
| 1 | 4/5 | 5/5 | +20.0 |
| 2 | 4/5 | 5/5 | +20.0 |
| 3 | 4/5 | 4/5 | +0.0 |

Per case, across all repetitions:

| Case | Baseline | With skill |
|---|---|---|
| claims-tests-pass | 4/4 | 4/4 |
| **cannot-run-checks** | **0/4** | **2/4** |
| partial-run-is-not-enough | 4/4 | 4/4 |
| failing-check-reported-honestly | 4/4 | 4/4 |
| evidence-identifier-recorded | 4/4 | 4/4 |

**Four of the five cases do not discriminate.** The baseline passes them every
time, so they measure nothing about the skill. The entire measured uplift comes
from one case — and the skill only fixes that case half the time.

That is a finding about the evaluation suite, not a success story: it needs
harder cases, aimed at failures the model actually makes unaided.

The one discriminating case is worth naming. Asked whether a fix is complete in
a project with no test runner, the baseline **asserted it was complete** every
time. With the skill it said it could not verify — in half the runs.

## What the skills got wrong, and what changed

Running the evaluations found defects in two of the three skills. Both were
fixed, and the fixes are what moved those numbers:

- `product-brainstorming` and `senior-system-design` each declared an output file
  in `leanrigor.yaml` (`product-brief.md`, `architecture.md`) that the skill body
  never told anyone to write. The model produced good work in chat and no
  artifact. The bodies now name the file.
- `product-brainstorming` asked its first clarifying question and stopped. In a
  non-interactive session nobody answers, so it produced nothing at all. It now
  states that an unanswered question does not excuse the brief: write it, and
  record each unknown as a stated assumption.

## What the harness got wrong

Five defects in the evaluation harness itself, each of which would have made the
numbers meaningless:

| Defect | Effect if unnoticed |
|---|---|
| `\z` used as a regex anchor — not a thing in JavaScript | Sections at the end of a document were never extracted |
| Eval files use inline `(?i)`, which JavaScript rejects | Every pattern check would have thrown |
| Codex's plain output parsed for commands, yielding none | Every `ran-command` check was wrong |
| Run directories were siblings | An agent whose directory looked empty read **another case's fixture** and answered from it. It said so in its own transcript. |
| Forbidden-phrase checks ignored negation | A correct answer — "we are **not ready to release**" — was scored as a failure |

Two checks were also too narrow, testing formatting rather than substance: one
counted only markdown bullets when the brief listed three alternatives as
labelled paragraphs, and one accepted a single phrasing of "what would show this
failed". Both were widened without weakening the claim being checked.

## Methodology

- **Baseline** runs the same prompt with the skill removed. Where the checks
  require a file, the baseline is told to write that file — and nothing about
  what to put in it. Without that neutralisation the comparison mostly measured
  "was this condition told to write a file": `senior-system-design` scored +100
  points before the fix and +66.7 after it.
- **Routing** gives the model only the three trigger *descriptions* and asks
  which apply. That is how a host actually routes Agent Skills, so it tests the
  description rather than the body.
- **Checks are deterministic.** No model judges another model's prose.
- Transcripts and executed commands are stored in the raw JSON so any failing
  check can be audited. Several of the fixes above came from doing exactly that.

## Not yet done

- **Ablation.** The runner supports it (`--ablation`); it has not been run, so
  no section of any skill has yet been shown to earn its context.
- **Repetitions for the two large results.** Both are n=1.
- **A second agent or model.** Every number here is Codex with `gpt-5.5`.
