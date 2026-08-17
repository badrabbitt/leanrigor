---
name: verification
description: Use before claiming that work is complete, fixed, passing or done — including before committing, opening a pull request or reporting a result. Requires running the checks and quoting their real output instead of asserting success.
license: Apache-2.0
---

# Verification

A completion claim is a factual claim. Make it only from output you have seen in
this session.

## The rule

Before writing "done", "fixed", "passing", "works" or "complete", you must have:

1. run the command that proves it, in this session, after the last change;
2. read its exit status and output;
3. quoted the decisive line in your report.

If you cannot run the command, say what you could not verify. That is a complete
answer. "It should work" is not.

## What counts as evidence

| Claim | Evidence |
|---|---|
| tests pass | the test runner's summary line and exit status |
| the bug is fixed | the failing reproduction now succeeding |
| it builds | the build command's exit status |
| types are sound | the typechecker's output, not the absence of editor errors |
| the API works | the actual request and response |
| nothing else broke | the full suite, not the one file you touched |

A green result from before your change is not evidence about your change.

## Procedure

1. **Name the claim.** What exactly are you about to assert?
2. **Pick the check.** The command whose output would change if the claim were
   false. If no such command exists, the claim is unverified — say so.
3. **Run it.** Fresh, after the final edit.
4. **Read the output.** Exit status *and* content. A suite that reports
   "0 tests ran" exits zero.
5. **Quote it.** One decisive line in your report.
6. **Record the identifier.** The run id, log handle or command line, so the
   claim can be re-checked later.

## Failure is a result

When the check fails, report the failure and what it says. Do not soften it, do
not re-run hoping for a different outcome, and do not narrow the check until it
passes.

## Anti-patterns

- Claiming success from a partial run ("the file I changed passes").
- Treating a skipped or filtered suite as a passing suite.
- Reporting completion while a step is still running.
- Describing intended behaviour in the past tense.
- Deleting or weakening a failing assertion to reach green.
