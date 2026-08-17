# LeanRigor

**Less context. Full engineering rigor.**

A local-first, cross-agent engineering harness. LeanRigor removes unnecessary
context from coding-agent sessions while preserving the design, test, security
and verification gates the task's risk level actually requires.

```bash
npx leanrigor init
```

## The contract

This is the part to read before the numbers.

- **Required engineering gates are never removed to save tokens.** Verification
  is mandatory at every risk level; a critical task cannot skip its threat
  model, approval or rollback plan for any reason, including a token budget.
- **Savings count only for work that passed.** A reduction achieved by producing
  a wrong answer is not a reduction, and it is excluded from every total.
- **Every number states its measurement mode and coverage.** A local estimate is
  never called provider usage, and two measurement modes are never added
  together into an unlabelled total.
- **Nothing is destroyed.** Every projection carries a handle that restores the
  original bytes, or is explicitly marked summary-only.
- **Telemetry is off by default**, and `leanrigor telemetry inspect` prints the
  exact payload before you decide.
- **Energy figures are versioned estimate ranges**, never datacenter
  measurements. See [docs/environmental-methodology.md](docs/environmental-methodology.md).

## Measured result

From the deterministic corpus in `evals/`, reproducible with one command:

```bash
npx leanrigor benchmark
```

| Metric | Value | Cases | Measurement |
|---|---|---|---|
| Median context reduction | **93.3%** | 8 passing | byte-only |
| Pass-rate delta vs baseline | **0.0 points** | 8 | deterministic verifier |
| Completion rate | 100% | 8 | — |

Per-case figures, the raw result and the release-gate verdict are in
[docs/benchmarks/](docs/benchmarks/). Every percentage there states the case
count and the measurement mode behind it.

**What this does not claim.** These cases measure what LeanRigor's own
transformations do to a payload — no model is involved. The skill-uplift claims
are not yet evidence-backed; [`evals/README.md`](evals/README.md) says exactly
which runs have not been done.

## What it does

| Piece | Job |
|---|---|
| **MCP gateway** | Exposes 4 tools to your host instead of 200. Tools are searched, not broadcast; large results are stored locally and returned as a compact, handle-backed projection. |
| **TokenLeaf Engine** | Measures what was actually saved, per measurement mode, and refuses to count savings from failed work. |
| **Rigor Gates** | Classifies task risk deterministically — no model call — and selects the smallest sufficient set of engineering gates. |
| **Verified Skills** | Three portable Agent Skills with licenses, provenance records, context budgets and evaluation suites. |

## Supported hosts

| Host | Status |
|---|---|
| Claude Code | supported |
| Codex | supported |
| Gemini CLI | not yet; adapter planned |

`leanrigor init` detects what is installed, **previews every file change**, backs
up anything it modifies, and never writes before you confirm.

## Commands

```bash
npx leanrigor init              # install, with a preview and confirmation
npx leanrigor init --dry-run    # show the plan, write nothing
npx leanrigor init --uninstall  # restore the original files
npx leanrigor doctor            # diagnose the installation
npx leanrigor mcp serve         # run the gateway (hosts launch this)
npx leanrigor benchmark         # run the reproducible benchmark
npx leanrigor report            # local session report
npx leanrigor report --share    # local SVG card, aggregate counts only
npx leanrigor skills list
npx leanrigor skills install verification
npx leanrigor telemetry status
```

## Privacy defaults

No account. No network call of its own until you enable telemetry. Prompts,
source code, file paths, repository names and tool payloads are never sent
anywhere, at any setting — the ledger and telemetry schemas have no field that
could carry them. See [docs/privacy.md](docs/privacy.md).

## Uninstall

```bash
npx leanrigor init --uninstall
```

Files are restored to their original bytes. The only thing left behind is an
append-only audit record under `.leanrigor/`.

## Current limitations

Stated plainly, because a harness that overstates itself is worse than none:

- The skill-uplift evaluations need model credentials and **have not been run**.
- The benchmark's `gateway+workflow` and `gateway+workflow+skill` conditions are
  not implemented yet; only `baseline` and `gateway` run today.
- Risk classification is regex-and-path based. It is deliberately conservative
  and will over-classify before it under-classifies, but it is not clever.
- The Codex adapter rewrites `config.toml`, which drops TOML comments. The
  install plan warns about this and the original is backed up.
- No Gemini CLI adapter yet.
- The published package bundles the internal `@leanrigor/*` workspaces; those
  APIs are not stable and are not published separately.

## Documentation

- [Getting started](docs/getting-started.md)
- [Measurement boundaries](docs/measurement-boundaries.md) — what is measured, estimated and unknowable
- [Environmental methodology](docs/environmental-methodology.md)
- [Privacy](docs/privacy.md)
- [Evaluations](evals/README.md)
- [Security policy](SECURITY.md)
- [Governance](GOVERNANCE.md)

## Contributing

Bounded, ownable extension surfaces are documented in
[docs/extensions/](docs/extensions/): projectors, host adapters and skill packs.
Each has an acceptance contract, so a contribution can be judged against a stated
bar rather than a maintainer's mood.

## License

Apache-2.0. Third-party notices, and the reuse ledger, are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). No third-party source or prose
has been copied into this repository.
