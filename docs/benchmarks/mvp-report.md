# LeanRigor benchmark

## Result

| Metric | Value | Cases | Measurement |
|---|---|---|---|
| Baseline pass rate | 100.0% | 8 | deterministic verifier |
| Candidate pass rate | 100.0% | 8 | deterministic verifier |
| Pass-rate delta | 0.0 points | 8 | deterministic verifier |
| Median context reduction | 93.3% | 8 passing | byte-only |

## Per case

| Case | Baseline bytes | Optimized bytes | Reduction | Passed |
|---|---:|---:|---:|---|
| json-github-issues | 491,885 | 10,931 | 97.8% | yes |
| json-repo-search | 75,247 | 2,503 | 96.7% | yes |
| log-npm-install | 51,544 | 421 | 99.2% | yes |
| log-vitest-run | 14,263 | 447 | 96.9% | yes |
| diff-service | 4,226 | 11,883 | -181.2% | yes |
| catalog-10-tools | 4,401 | 4,401 | 0.0% | yes |
| catalog-50-tools | 22,081 | 8,932 | 59.5% | yes |
| catalog-200-tools | 88,581 | 8,933 | 89.9% | yes |

## Release gate

```text
Release gate

  [ok  ] completion-rate            100.0% of 8 cases completed (minimum 90%)
  [ok  ] pass-rate-delta            pass rate changed by +0.0 points (floor -2)
  [ok  ] median-context-reduction   median reduction 93.3% over 8 passing case(s) (minimum 40%)
  [ok  ] no-critical-violations     no open critical privacy or provenance violation
  [ok  ] mcp-conformance            MCP conformance passed against its reviewed baseline

Release may proceed.
This release may advertise its measured savings.
```

Every percentage above states the case count and the measurement mode it came
from. Savings are counted only for cases that passed their deterministic
verifier with all mandatory gates satisfied.
