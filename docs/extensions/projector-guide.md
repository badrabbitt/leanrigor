# Writing a projector

A projector turns a large payload into a small view without rewriting its
meaning. It is the most self-contained thing you can own in LeanRigor: one file,
one test file, no coupling to the gateway.

## The interface

```ts
interface Projector {
  readonly name: string;
  supports(input: ProjectionInput): boolean;
  project(input: ProjectionInput, budget: ProjectionBudget): ProjectionResult;
}
```

`ProjectionResult` must carry `lossPolicy`, `summary`, `view`, `originalHandle`,
`availableViews` and both byte counts.

## The rules

1. **Deterministic.** No model call, no clock, no randomness. The same bytes and
   the same budget must produce the same view, forever.
2. **Reversible.** Always return `originalHandle`. A view is a lens, not a
   replacement.
3. **Never emit malformed output.** If the projection exceeds its byte budget,
   return a *smaller valid document* — an index, a summary — not a truncated
   one. A JSON view cut mid-token is worse than no view.
4. **Preserve types.** A field the model reads must have exactly the type and
   value it had upstream. Do not stringify numbers, do not drop `null`.
5. **State the loss.** `lossless`, `reversible-lossy` or `summary-only`, and mean
   it.
6. **Cheap.** A projector runs on every tool result. Quadratic work needs a
   bounded fallback, as `unifiedDiff` has.

## Acceptance contract

A projector is merged when it has:

- [ ] golden fixture tests, with a realistic payload — not a toy
- [ ] a test proving the view stays inside its byte budget
- [ ] a test proving the output is still valid when the budget forces a fallback
- [ ] a test proving `originalHandle` survives every path
- [ ] a determinism test (project twice, compare)
- [ ] a stated loss policy per code path
- [ ] a measured reduction on a realistic fixture, quoted in the pull request

## Where things go

```text
packages/result-store/src/projectors/<name>.ts
packages/result-store/test/projectors/<name>.test.ts
```

Export it from `projectors/index.ts`, and add it to the gateway's default list
in `packages/mcp-gateway/src/gateway.ts` if it should run automatically. Order
matters: the first projector whose `supports()` returns true wins, so a narrow
projector goes before a general one.

## Worked example

`packages/result-store/src/projectors/log.ts` is the clearest one to copy. It
groups repeated lines, keeps exact repetition counts, and surfaces the first
error with its original line number — the two things a reader of a build log
actually needs. On the benchmark corpus it reduces a 51 KiB install log to
421 bytes.
