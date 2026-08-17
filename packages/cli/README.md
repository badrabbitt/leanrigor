# leanrigor

**Less context. Full engineering rigor.**

A local-first, cross-agent engineering harness. LeanRigor removes unnecessary
context from coding-agent sessions while preserving the design, test, security
and verification gates that the task's risk level requires.

```bash
npx leanrigor init
```

## Quality-first contract

- Required engineering gates are never removed to save tokens.
- Savings are counted only for tasks that pass their deterministic verifier.
- Every reported number states its measurement mode and coverage.
- Telemetry is disabled by default and carries no prompts, paths or source.
- Energy figures are versioned estimate ranges, never datacenter measurements.

## Status

Early development. Commands that are not implemented exit with code 2 and a
stable error code rather than reporting false success.

See the [project repository](https://github.com/badrabbitt/leanrigor) for
documentation, benchmarks and the measurement methodology.

## License

Apache-2.0
