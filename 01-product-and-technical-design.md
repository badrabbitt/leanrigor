# LeanRigor Product and Technical Design

**Date:** 2026-08-17  
**Status:** Approved product direction, implementation not started  
**Product name:** LeanRigor  
**Tagline:** Less context. Full engineering rigor.  
**Primary installation:** `npx leanrigor init`  
**License for original code:** Apache-2.0

## 1. Executive summary

LeanRigor is a local-first, cross-agent engineering harness that removes unnecessary context while preserving the engineering discipline required to produce verified results. It combines deterministic context optimization, risk-adaptive workflows, evaluated skills and evidence-based completion gates.

The public promise is:

> **Less context. Full engineering rigor.**

The product is quality-first: a smaller prompt is not a success if it removes a necessary design, test, security or verification step. The first release therefore optimizes the information path and chooses the smallest sufficient workflow for the task risk. It stores large tool results outside model context, returns compact reversible handles, supports selective reads and structural diffs, routes only relevant skills, and records evidence for every required quality gate.

The internal **TokenLeaf Engine** measures the efficiency side of the product. LeanRigor reports four separate classes of metrics:

1. Bytes directly processed by LeanRigor.
2. Estimated tokens before and after optimization.
3. Provider-reported usage when a supported SDK exposes it.
4. Optional energy and carbon ranges marked as estimates, never as datacenter measurements.

The project will not hide the origin of reused code or derivative content. Original architecture is the competitive core. Public engineering practices are studied, distilled into independently worded decision procedures, evaluated, and accompanied by machine-readable provenance. Code or text copied under a permissive license retains required notices.

## 2. Problem

Coding agents waste context and money in recurring ways:

- every tool schema may be exposed before it is needed;
- large logs, JSON responses and files are returned in full;
- unchanged information is reread across turns;
- multiple skills repeat the same instructions;
- rigid workflows apply expensive design and review gates to trivial changes;
- aggressive compression can delete important information and cause retries;
- token-saving projects often report savings without measuring task quality;
- environmental claims are frequently derived from unsupported token-to-CO2 constants.

The market already includes output-shortening skills, prompt compressors, MCP caching tools, skill collections and coding harnesses. LeanRigor therefore must not compete as another generic prompt, skill marketplace or agent framework. Its defensible unit is a **quality-gated, context-efficient engineering workflow** with reproducible measurements.

### 2.1 Product thesis

LeanRigor optimizes two objectives together:

1. Minimize tokens, bytes, repeated instructions, irrelevant tools and unnecessary workflow steps.
2. Preserve or improve verified task success, safety and engineering completeness.

The order matters: correctness and required safeguards are constraints; token reduction is the optimization objective inside those constraints.

### 2.2 Brand architecture

| Name | Meaning | Public role |
|---|---|---|
| **LeanRigor** | Efficient execution with full engineering discipline | Product, CLI, npm package and community |
| **TokenLeaf Engine** | Measurement and context-reduction subsystem | Internal engine and optional metrics API |
| **Rigor Gates** | Risk-adaptive design, test, review and verification gates | Workflow terminology |
| **Verified Skills** | Skills admitted through evals, budgets and provenance checks | Installable skill packs |

TokenLeaf is not a second product or public CLI. It is a named engine inside LeanRigor, which prevents the top-level brand from implying that token count is more important than outcome quality.

## 3. Goals

### 3.1 Product goals

1. Install locally in less than three minutes with `npx leanrigor init`.
2. Demonstrate useful savings in the first session without requiring a cloud account.
3. Reduce serialized MCP tool-result context by at least 40% on the public benchmark corpus.
4. Keep benchmark task pass rate within two percentage points of the unoptimized baseline.
5. Support Claude Code and Codex in the first stable release; add Gemini through an adapter after the core is stable.
6. Provide three verified skills: product brainstorming, senior system design and verification.
7. Publish npm packages with trusted publishing and provenance attestations.
8. Make telemetry explicitly opt-in and transmit only aggregate measurements.
9. Create at least twelve meaningful extension surfaces so external maintainers can own adapters, projectors, benchmark packs and domain skills.

### 3.2 Open-source growth goals

| Horizon | Target |
|---|---|
| 30 days after alpha | 100 GitHub stars, 100 npm weekly downloads, 10 benchmark users |
| 90 days | 1,000 stars, 5,000 npm monthly downloads, 5 external maintainers with merged code or benchmark packs |
| 6 months | 5,000 stars, 25,000 npm monthly downloads, 20 unique external maintainers with substantive merged work |
| 12 months | 100,000 npm monthly downloads or 500 dependent repositories; active community governance |
| Stretch | 200,000 combined monthly registry downloads without artificial package splitting or install inflation |

These are directional targets, not promises. The near-term Claude for Open Source route remains twenty unique external contributors with substantive merged work; registry downloads are the longer-term route.

### 3.3 Quality-adjusted efficiency goals

Primary metric:

```text
quality_adjusted_savings
  = (baseline_estimated_tokens - optimized_estimated_tokens)
    * task_pass_rate
```

Supporting metrics:

```text
context_reduction_ratio
task_pass_rate_delta
cost_per_passing_task
tokens_per_passing_task
tool_calls_per_passing_task
retry_rate
wall_clock_duration
```

Savings are invalid when the optimized task does not pass its deterministic verifier. For high- and critical-risk tasks, passing also requires all mandatory Rigor Gates; token reduction never compensates for a missing gate.

## 4. Non-goals for the first release

- Building a new foundation-model agent loop.
- Proxying or decrypting proprietary coding-agent API traffic.
- Claiming visibility into hidden reasoning tokens.
- Replacing Claude Code, Codex, Gemini CLI or OpenCode.
- Shipping a hosted skill marketplace.
- Persisting user prompts, source code or raw tool outputs on a LeanRigor server.
- Converting tokens to an exact CO2 value.
- Creating dozens of low-value npm packages to inflate download totals.
- Copying source-available material as if it were open source.
- Republishing third-party skills without license review and required notices.

## 5. Users and jobs to be done

### 5.1 Individual developer

Wants coding-agent sessions to last longer, cost less and remain understandable. Installs the CLI, enables the MCP gateway and sees per-operation savings.

The user should experience the product as a disciplined engineering assistant that happens to use less context, not as a compressor that occasionally performs engineering checks.

### 5.2 Open-source maintainer

Wants stable, repeatable agent workflows across contributors. Commits LeanRigor configuration and selected skills to the repository while keeping personal telemetry disabled by default.

### 5.3 Agent-skill author

Wants evidence that a skill improves behavior. Uses baseline-versus-skill evaluation, provenance metadata and token-budget checks.

### 5.4 Platform team

Wants aggregate cost and quality measurements without leaking source or prompts. Uses an internal telemetry endpoint or self-hosted collector.

## 6. Product experience

### 6.1 Installation

```bash
npx leanrigor init
```

The wizard detects supported hosts and asks which integration to install. It previews every file change and requires confirmation before modifying host configuration.

### 6.2 Local report

```text
LeanRigor session report — powered by TokenLeaf Engine

MCP operations optimized                  42
Raw payload bytes                  2,804,112
Returned payload bytes               611,420
Estimated tool-context tokens avoided 478,900
Estimated reduction                     78.2%
Verified tasks passed                    8 / 8
Required Rigor Gates passed             24 / 24
Quality-adjusted savings               478,900

Measurement: cl100k-compatible estimator
Coverage: MCP schemas and results handled by LeanRigor only
Environmental estimate: disabled
```

### 6.3 Share command

```bash
npx leanrigor report --share
```

The share artifact contains aggregate measurements, estimator name, measurement coverage and benchmark status. It contains no prompt, repository name, file path or tool payload.

### 6.4 Telemetry commands

```bash
npx leanrigor telemetry status
npx leanrigor telemetry inspect
npx leanrigor telemetry enable
npx leanrigor telemetry disable
```

Telemetry is disabled until the user runs `enable`. `inspect` prints the exact next payload.

## 7. Architecture

```text
Claude Code / Codex / later Gemini
                 |
          Host Adapter Layer
                 |
          Rigor Gate Runtime
          |                 |
  Verified Skill Router  TokenLeaf Engine
          |                 |
      Context-efficient MCP Gateway
          |                 |
   Upstream MCPs      Content Store
```

### 7.1 CLI

Responsibilities:

- initialization and host detection;
- configuration preview and reversible installation;
- starting the local MCP gateway;
- local reports and share cards;
- benchmark execution;
- telemetry consent management;
- skill installation and validation.

### 7.2 TokenLeaf Engine

TokenLeaf Engine contains the local ledger, tokenizer adapters and quality-adjusted savings calculator. It records only measurements and hashes by default:

```ts
type MeasurementMode =
  | "provider-usage"
  | "provider-count-api"
  | "tokenizer-estimate"
  | "byte-only";

interface LedgerEvent {
  eventId: string;
  sessionId: string;
  operation: "tool-schema" | "tool-result" | "resource" | "skill" | "workflow";
  baselineBytes: number;
  optimizedBytes: number;
  baselineTokens?: number;
  optimizedTokens?: number;
  measurementMode: MeasurementMode;
  estimator?: string;
  passed?: boolean;
  createdAt: string;
}
```

It never calls provider-estimated usage “actual”. Only usage returned by a provider SDK is labeled provider usage.

### 7.3 Content-addressed result store

Large results are stored under a SHA-256 content identifier. The model receives:

```json
{
  "handle": "lr_sha256_...",
  "summary": "482 GitHub issues; 19 open; 4 labelled security",
  "schema": "github.issue[]",
  "available_views": ["open", "security", "by-number", "fields"],
  "expires_at": "2026-08-18T09:00:00Z"
}
```

The agent can request a view or slice instead of the complete payload. Storage is local, scoped by project and session, and garbage-collected by size and age.

### 7.4 Structural projectors

Projectors reduce payloads without rewriting semantics:

- JSON field projection and pagination;
- log grouping and repetition counts;
- unified-diff generation;
- tabular sampling with preserved headers;
- code range extraction;
- error-first test output;
- schema summaries;
- binary metadata extraction without embedding bytes.

Each projector must provide a loss policy: lossless, reversible-lossy or summary-only. Summary-only output must retain a handle to the original data.

### 7.5 MCP gateway

The gateway connects to upstream MCP servers and exposes a compact interface. It supports:

- tool catalog indexing;
- tool search;
- namespaced invocation;
- schema measurement;
- result capture and projection;
- timeouts, cancellation and size limits;
- audit events without payload logging;
- protocol conformance testing.

OpenAI-native deferred tool loading is used when available. MCP dynamic-list behavior is supported according to the negotiated protocol version. LeanRigor must not claim that every host can defer tool schemas in the same way.

### 7.6 Rigor Gate runtime

Tasks are classified by risk, not by requested verbosity:

| Risk | Examples | Required gates |
|---|---|---|
| Trivial | typo, formatting | scope check, edit, verification |
| Low | isolated bug, small test | reproduce, regression test, verification |
| Medium | feature touching one bounded component | clarify, short design, tests, implementation, review |
| High | cross-component feature, migration | discovery, design, plan, isolation, tests, review, rollout |
| Critical | auth, payment, security, destructive data | threat model, explicit approvals, rollback, independent review |

The classifier emits reasons and can be overridden by the user. It may remove redundant steps, combine compatible gates and use compact evidence handles, but it cannot skip security, destructive-action or verification gates based only on token cost.

### 7.7 Skill router

LeanRigor follows the Agent Skills folder format and adds an optional `leanrigor.yaml` sidecar:

```yaml
schema_version: 1
skill: senior-system-design
version: 0.1.0
risk_levels: [medium, high, critical]
context_budget_tokens: 8000
outputs:
  - architecture.md
  - decisions/*.md
requires:
  - product-brief
verification:
  suite: evals/system-design.yaml
provenance:
  manifest: provenance.yaml
```

The standard `SKILL.md` remains portable. LeanRigor-specific metadata is optional and must not break other agents.

### 7.8 Verified skill packs

Initial packs:

1. `product-brainstorming`: problem, user, alternatives, scope and validation.
2. `senior-system-design`: functional requirements, NFRs, capacity, data, reliability, security, observability, cost and rollout.
3. `verification`: evidence collection before completion claims.

Every published skill needs:

- valid Agent Skills metadata;
- a bounded trigger description;
- explicit inputs and outputs;
- deterministic checks where possible;
- at least five evaluation cases;
- baseline-versus-skill comparison;
- context-budget report;
- provenance record;
- license review.

### 7.9 Telemetry service

The optional service receives anonymous aggregate events:

```ts
interface AggregateTelemetryEvent {
  schemaVersion: 1;
  eventId: string;
  anonymousInstallId: string;
  day: string;
  host: "claude-code" | "codex" | "gemini" | "other";
  measurementMode: MeasurementMode;
  baselineTokens?: number;
  optimizedTokens?: number;
  baselineBytes: number;
  optimizedBytes: number;
  verifiedTasks: number;
  passedTasks: number;
  clientVersion: string;
}
```

Server rules:

- reject unknown fields;
- cap values per event;
- deduplicate `eventId`;
- rate-limit install IDs and IPs;
- delete source IPs after abuse checks;
- never accept arbitrary metadata;
- publish methodology and retention policy;
- label public totals community-reported rather than provider-verified.

## 8. Environmental methodology

### 8.1 What is measured

LeanRigor can directly measure serialized bytes before and after its own transformations. It can estimate tokens with a named tokenizer. It can record provider usage only when the integration exposes official usage fields.

### 8.2 What is estimated

Energy estimates use a versioned range model:

```text
estimated_energy_range
  = input_prefill_estimate
  + output_decode_estimate
  + declared_infrastructure_overhead_range
```

Inputs include model family when known, input/output split, cache status when exposed and estimator version. Unknown variables widen the range.

### 8.3 Communication rules

Allowed:

- “Estimated tool-context tokens avoided.”
- “Potential inference work avoided.”
- “Energy estimate based on published assumptions.”

Disallowed:

- “Exact CO2 saved.”
- tree, water-bottle or household equivalents without peer-reviewed, reproducible assumptions;
- combining failed optimized runs with savings totals;
- comparing estimators as if they were provider telemetry.

## 9. Provenance and reuse policy

### 9.1 Source classes

| Class | Permitted use |
|---|---|
| Public idea or engineering principle | Independently express and test the principle; cite the research catalog |
| Permissively licensed code/text | Reuse only after license review; retain required copyright and license notices |
| Copyleft code | Keep out of the core unless the project intentionally adopts compatible obligations |
| Source-available content | Study public behavior; do not copy unless its specific terms allow the intended distribution |
| Proprietary/leaked code | Do not ingest, copy or use as an implementation source |

### 9.2 Derivation record

```yaml
artifact: skills/senior-system-design
implementation: independently-authored
influences:
  - project: obra/superpowers
    license: MIT
    concepts: [design-gate, verification-gate]
  - source: AWS Builders Library
    use: research-only
    concepts: [retry-budget, backoff, overload]
copied_files: []
reviewed_by: maintainer
```

This record is stored in the repository. It does not need to be inserted into every agent response.

## 10. Package and repository design

### 10.1 Monorepo

```text
leanrigor/
├── apps/
│   └── telemetry-api/
├── packages/
│   ├── cli/
│   ├── core/
│   ├── tokenleaf-engine/
│   ├── result-store/
│   ├── mcp-gateway/
│   ├── workflow-runtime/
│   ├── skill-router/
│   ├── host-claude/
│   ├── host-codex/
│   ├── benchmark/
│   └── energy-estimator/
├── skills/
│   ├── product-brainstorming/
│   ├── senior-system-design/
│   └── verification/
├── evals/
├── provenance/
├── docs/
└── package.json
```

### 10.2 npm packages

MVP publishes one user-facing package and keeps internal libraries private until an external API is stable:

```text
leanrigor                 public CLI and MCP entry point
@leanrigor/core           public after API stabilization
@leanrigor/tokenleaf      public only if the measurement API stabilizes
@leanrigor/skill-kit      public when third-party skill validation is stable
@leanrigor/benchmark      public when benchmark format is stable
```

Primary commands:

```bash
npx leanrigor init
npx leanrigor doctor
npx leanrigor mcp serve
npx leanrigor benchmark
npx leanrigor report
npx leanrigor skills list
npx leanrigor skills install senior-system-design
```

The release workflow uses npm trusted publishing through GitHub Actions, provenance attestations, 2FA-protected maintainership and `npm pack --dry-run` checks.

## 11. Benchmark design

### 11.1 Corpus

- large JSON API responses;
- repeated build and test logs;
- repository search results;
- Git diffs;
- MCP servers with 10, 50 and 200 tools;
- skills with overlapping instructions;
- trivial, medium and high-risk coding tasks.

### 11.2 Experimental conditions

Each task runs under:

1. baseline host without LeanRigor;
2. gateway-only optimization;
3. gateway plus adaptive workflow;
4. gateway, workflow and selected skill.

### 11.3 Required outputs

- deterministic pass/fail;
- input, output and tool-result usage when available;
- estimator measurements otherwise;
- duration, calls, retries and errors;
- exact versions and random seed;
- failure artifacts with secrets removed.

### 11.4 Release gate

A release cannot advertise savings unless:

- at least 90% of benchmark tasks complete;
- pass-rate delta is no worse than -2 percentage points;
- median tool-context reduction is at least 40%;
- no critical privacy or provenance violation is open;
- all MCP conformance tests for supported protocol versions pass.

## 12. Security and privacy

- Local-first; no account required.
- Telemetry off by default.
- Never log tool payloads unless explicit debug mode is enabled.
- Debug artifacts display a secret-warning banner and expire locally.
- Upstream MCP commands are configured explicitly; LeanRigor does not discover and execute arbitrary commands from untrusted repositories.
- Configuration edits are previewed and backed up.
- Path access is restricted to configured roots.
- Remote MCP credentials remain with the upstream client or secret provider.
- Dependency versions are locked; releases use artifact attestations.
- Skills containing scripts declare network, shell, filesystem and secret capabilities.

## 13. Roadmap at 20 hours per week

| Weeks | Deliverable | Hours |
|---|---|---:|
| 1–2 | benchmark baseline, measurement boundaries, repo and CLI | 40 |
| 3–4 | token ledger and local reports | 40 |
| 5–6 | result store and JSON/log/diff projectors | 40 |
| 7–8 | MCP gateway and conformance tests | 40 |
| 9 | Claude and Codex installation adapters | 20 |
| 10 | adaptive workflow runtime | 20 |
| 11 | three verified skill packs and provenance | 20 |
| 12 | npm trusted release, docs, launch demo | 20 |
| 13–16 | external projector and adapter program | 80 |
| 17–24 | benchmark expansion, Gemini adapter, public telemetry | 160 |

Weekly allocation after launch:

```text
8h core engineering
4h benchmark and quality
4h issue/PR review and maintainer support
2h documentation and examples
2h upstream ecosystem work
```

## 14. Viral launch loop

1. Record a 30-second before/after terminal demo.
2. Publish a reproducible benchmark, not a marketing-only percentage.
3. Generate share cards locally.
4. Launch a “100 MCP payloads” benchmark challenge.
5. Invite maintainers to add one projector, host adapter or domain benchmark pack.
6. Publish a weekly quality-adjusted token leaderboard.
7. Provide a README badge that shows benchmarked project savings, not unverified global claims.
8. Post technical write-ups explaining failures where compression increased cost or reduced quality.

## 15. Principal risks and mitigations

| Risk | Mitigation |
|---|---|
| Savings cannot be measured across proprietary clients | Define coverage precisely; measure only handled context; use SDK adapters for provider usage |
| Compression damages quality | Reversible handles, deterministic verifiers, baseline comparison, fail-open mode |
| Host adds native deferred tools | Position projectors, ledger and workflow efficiency as the durable core; use native features where available |
| Privacy concerns about telemetry | Off by default, exact payload inspection, no free-form metadata, self-host option |
| Greenwashing | Report direct measurements separately from versioned estimate ranges |
| Scope grows into an agent framework | No model loop in MVP; integrate with existing hosts |
| Third-party license violation | Automated manifest plus human review; quarantine unknown licenses |
| Too many low-value skill submissions | Require evals, token budgets, provenance and owner commitment |
| npm supply-chain compromise | OIDC trusted publishing, provenance, 2FA, minimal maintainers, staged releases |

## 16. Decision record

The selected approach is a hybrid: an original context-efficiency engine, a risk-adaptive Rigor Gate runtime and verified skill packs informed by public sources. **LeanRigor** is the product and public brand; **TokenLeaf Engine** is the internal measurement subsystem. Aggregation is not the product. Third-party material is never presented as original when it has been copied or adapted.
