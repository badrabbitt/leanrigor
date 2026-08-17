# LeanRigor MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Product:** LeanRigor  
**Tagline:** Less context. Full engineering rigor.  
**Goal:** Build and publish a local-first `leanrigor` npm engineering harness that reduces unnecessary tool context, preserves every risk-required engineering gate, installs three evaluated skills, and reports quality-adjusted savings through the internal TokenLeaf Engine.

**Architecture:** A TypeScript ESM monorepo keeps TokenLeaf Engine measurement, storage, MCP transport, Rigor Gate workflow, verified-skill routing and host adapters behind narrow interfaces. The CLI is the only public package in the MVP; internal workspaces are bundled into it until their APIs stabilize. Transformations are reversible through local content handles. Benchmark pass rate and mandatory-gate completion jointly control every advertised savings claim.

**Tech Stack:** Node.js 22 and 24, TypeScript, npm workspaces, Vitest, Zod, official MCP TypeScript SDK, Hono for the optional telemetry API, filesystem content-addressed storage, GitHub Actions, npm trusted publishing.

## Global Constraints

- Original code is Apache-2.0; third-party notices remain in `THIRD_PARTY_NOTICES.md`.
- Node.js minimum is 22; CI tests Node.js 22 and 24 on Ubuntu, macOS and Windows.
- ESM only; public imports use explicit package exports.
- Telemetry is disabled by default and accepts no prompt, source, path, repository or arbitrary metadata fields.
- UI says “estimated tool-context tokens avoided” unless official provider usage is present.
- Energy and carbon values are versioned ranges and are never described as datacenter measurements.
- No proprietary API interception, leaked source, hidden reasoning collection or arbitrary command discovery.
- Every optimization has a reversible original handle or is explicitly marked summary-only.
- Required design, test, security, destructive-action and verification gates cannot be removed merely to save tokens.
- A release advertising savings must meet both the quality benchmark and Rigor Gate coverage requirements in the design document.
- Use TDD for every behavior; each task ends in a testable deliverable and focused commit.

---

## File map

```text
package.json                         workspace scripts and package list
tsconfig.base.json                  shared strict TypeScript configuration
vitest.workspace.ts                 workspace test discovery
LICENSE                             Apache-2.0
THIRD_PARTY_NOTICES.md              retained notices and reuse ledger
packages/core/                      shared types, errors and configuration
packages/tokenleaf-engine/          measurement, estimates and quality-adjusted reports
packages/result-store/              content handles, retention and projectors
packages/mcp-gateway/               upstream MCP catalog, invocation and projections
packages/workflow-runtime/          risk classification and Rigor Gate selection
packages/skill-router/              Agent Skills validation, routing and provenance
packages/host-claude/               reversible Claude Code configuration adapter
packages/host-codex/                reversible Codex configuration adapter
packages/energy-estimator/          disclosed estimate ranges
packages/benchmark/                 baseline/candidate runner and release gates
packages/cli/                       user-facing `leanrigor` binary
apps/telemetry-api/                 optional aggregate collector
skills/                             three initial portable skills
evals/                              deterministic fixtures and benchmark cases
docs/                               user, privacy, measurement and maintainer docs
```

### Task 1: Establish the monorepo and executable CLI

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `vitest.workspace.ts`
- Create: `packages/cli/package.json`
- Create: `packages/cli/src/cli.ts`
- Create: `packages/cli/test/cli.test.ts`
- Create: `LICENSE`
- Create: `THIRD_PARTY_NOTICES.md`

**Interfaces:**
- Produces: executable `leanrigor` binary and `runCli(argv: string[]): Promise<number>`.

- [ ] **Step 1: Write a failing CLI smoke test**

```ts
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";

describe("leanrigor CLI", () => {
  it("returns zero for --version", async () => {
    await expect(runCli(["--version"])).resolves.toBe(0);
  });
});
```

- [ ] **Step 2: Run the isolated test**

Run: `npm test --workspace packages/cli -- --run`  
Expected: FAIL because `runCli` does not exist.

- [ ] **Step 3: Implement the minimal CLI dispatcher**

Create a dispatcher with `--version`, `help`, `init`, `doctor`, `mcp`, `benchmark`, `report`, `skills` and `telemetry` command names. Unimplemented subcommands return exit code 2 and a stable error code rather than silently succeeding.

- [ ] **Step 4: Add workspace build, lint, typecheck and test scripts**

The root must support:

```bash
npm ci
npm run build
npm run typecheck
npm test
```

- [ ] **Step 5: Verify the package tarball**

Run: `npm pack --workspace packages/cli --dry-run`  
Expected: only compiled files, README, license, notices and package metadata are included.

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.base.json vitest.workspace.ts packages/cli LICENSE THIRD_PARTY_NOTICES.md
git commit -m "chore: initialize leanrigor workspace and cli"
```

### Task 2: Define measurement types and configuration boundaries

**Files:**
- Create: `packages/core/src/measurement.ts`
- Create: `packages/core/src/config.ts`
- Create: `packages/core/src/errors.ts`
- Create: `packages/core/src/index.ts`
- Test: `packages/core/test/measurement.test.ts`

**Interfaces:**
- Produces: `MeasurementMode`, `LedgerEvent`, `LeanRigorConfig`, `LeanRigorError` and Zod schemas for serialized inputs.

- [ ] **Step 1: Write failing schema tests**

Test that negative byte counts, unknown telemetry fields and `optimizedBytes > baselineBytes` with a claimed positive saving are rejected. Test all four measurement modes.

- [ ] **Step 2: Run the test and confirm schema failures**

Run: `npm test --workspace packages/core -- --run`  
Expected: FAIL because schemas are missing.

- [ ] **Step 3: Implement strict schemas and branded identifiers**

Use strict Zod objects. Define `eventId`, `sessionId` and content handles as non-empty branded strings. Do not include raw payload fields in `LedgerEvent`.

- [ ] **Step 4: Verify type and runtime behavior**

Run: `npm run typecheck && npm test --workspace packages/core -- --run`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat: define measurement and configuration contracts"
```

### Task 3: Implement TokenLeaf Engine and its local ledger

**Files:**
- Create: `packages/tokenleaf-engine/src/ledger.ts`
- Create: `packages/tokenleaf-engine/src/jsonl-store.ts`
- Create: `packages/tokenleaf-engine/src/report.ts`
- Create: `packages/tokenleaf-engine/src/index.ts`
- Test: `packages/tokenleaf-engine/test/ledger.test.ts`
- Test: `packages/tokenleaf-engine/test/report.test.ts`

**Interfaces:**
- Consumes: `LedgerEvent` from `@leanrigor/core`.
- Produces: `TokenLeafEngine.record(event)`, `TokenLeafEngine.sessionReport(sessionId)` and `renderSessionReport(report)`.

- [ ] **Step 1: Write failing aggregation tests**

```ts
it("excludes savings from failed tasks", async () => {
  await engine.record(passedEvent({ baselineTokens: 100, optimizedTokens: 40 }));
  await engine.record(failedEvent({ baselineTokens: 1000, optimizedTokens: 1 }));
  const report = await engine.sessionReport("session-1");
  expect(report.qualityAdjustedTokensAvoided).toBe(60);
});
```

- [ ] **Step 2: Confirm the tests fail**

Run: `npm test --workspace packages/tokenleaf-engine -- --run`.

- [ ] **Step 3: Implement append-only JSONL persistence**

Writes use a project-scoped directory, an exclusive append operation and schema validation before persistence. Corrupt lines are reported with offsets and skipped only in explicit recovery mode.

- [ ] **Step 4: Implement reports with measurement coverage**

Reports separate provider usage, provider count API, tokenizer estimates and byte-only events. Never add unlike measurement modes into an unlabeled total. Exclude savings from failed tasks or tasks missing mandatory Rigor Gate evidence.

- [ ] **Step 5: Test restart persistence and concurrent appends**

Run the package tests with temporary directories. Expected: no lost or partially parsed event.

- [ ] **Step 6: Commit**

```bash
git add packages/tokenleaf-engine
git commit -m "feat: add tokenleaf quality-adjusted measurement engine"
```

### Task 4: Build the content-addressed result store

**Files:**
- Create: `packages/result-store/src/store.ts`
- Create: `packages/result-store/src/handle.ts`
- Create: `packages/result-store/src/retention.ts`
- Test: `packages/result-store/test/store.test.ts`
- Test: `packages/result-store/test/retention.test.ts`

**Interfaces:**
- Produces: `ResultStore.put(bytes, metadata)`, `get(handle)`, `slice(handle, range)`, `remove(handle)` and `gc(policy)`.

- [ ] **Step 1: Test deterministic SHA-256 handles and project isolation**

The same bytes inside one project return the same handle; a handle cannot be read from a different project scope.

- [ ] **Step 2: Confirm tests fail**

Run: `npm test --workspace packages/result-store -- --run`.

- [ ] **Step 3: Implement atomic writes**

Write to a temporary file in the same directory, fsync, rename atomically and store metadata separately. Reject path fragments supplied by callers.

- [ ] **Step 4: Implement TTL and size-based garbage collection**

Pinned benchmark fixtures are never removed. Session content expires according to configuration, defaulting to seven days and 1 GiB.

- [ ] **Step 5: Test interrupted writes and malicious handles**

Expected: partial files are not returned; traversal strings and handles with invalid hashes are rejected.

- [ ] **Step 6: Commit**

```bash
git add packages/result-store
git commit -m "feat: add local content-addressed result storage"
```

### Task 5: Implement structural result projectors

**Files:**
- Create: `packages/result-store/src/projectors/types.ts`
- Create: `packages/result-store/src/projectors/json.ts`
- Create: `packages/result-store/src/projectors/log.ts`
- Create: `packages/result-store/src/projectors/diff.ts`
- Create: `packages/result-store/src/projectors/text.ts`
- Test: `packages/result-store/test/projectors/*.test.ts`

**Interfaces:**
- Produces: `Projector.supports(input)`, `project(input, budget)` and `ProjectionResult` with `lossPolicy`, `summary`, `view` and `originalHandle`.

- [ ] **Step 1: Write golden tests for JSON, repeated logs and text diffs**

Golden fixtures must assert preserved JSON field types, repetition counts, first error location and reversible handles.

- [ ] **Step 2: Confirm tests fail**

Run: `npm test --workspace packages/result-store -- --run projectors`.

- [ ] **Step 3: Implement projectors without model calls**

MVP projection is deterministic. JSON supports field allowlists and pages; logs group identical normalized lines; text returns bounded sections; diffs preserve line numbers.

- [ ] **Step 4: Add budget enforcement**

If projected output exceeds its byte or estimated-token budget, return a smaller index plus handle rather than truncating invalid JSON.

- [ ] **Step 5: Commit**

```bash
git add packages/result-store/src/projectors packages/result-store/test/projectors
git commit -m "feat: add deterministic context projectors"
```

### Task 6: Add tokenizer adapters and transparent estimates

**Files:**
- Create: `packages/tokenleaf-engine/src/tokenizers/types.ts`
- Create: `packages/tokenleaf-engine/src/tokenizers/openai.ts`
- Create: `packages/tokenleaf-engine/src/tokenizers/anthropic-api.ts`
- Create: `packages/tokenleaf-engine/src/tokenizers/byte-fallback.ts`
- Test: `packages/tokenleaf-engine/test/tokenizers.test.ts`

**Interfaces:**
- Produces: `TokenEstimator.count(text): Promise<TokenCount>` with estimator name, version and mode.

- [ ] **Step 1: Test measurement labeling**

An offline tokenizer result must be `tokenizer-estimate`; Anthropic's official count endpoint is `provider-count-api`; response usage is `provider-usage`; missing support is `byte-only`.

- [ ] **Step 2: Implement adapters with explicit credentials**

Never discover keys from arbitrary files. The count API adapter accepts a credential through the process environment named in documented configuration.

- [ ] **Step 3: Add fallback tests**

Network errors downgrade to byte-only only when configured; otherwise they return a typed measurement error.

- [ ] **Step 4: Commit**

```bash
git add packages/tokenleaf-engine/src/tokenizers packages/tokenleaf-engine/test/tokenizers.test.ts
git commit -m "feat: add labeled token measurement adapters"
```

### Task 7: Implement the MCP gateway catalog and invocation path

**Files:**
- Create: `packages/mcp-gateway/src/catalog.ts`
- Create: `packages/mcp-gateway/src/upstream.ts`
- Create: `packages/mcp-gateway/src/gateway.ts`
- Create: `packages/mcp-gateway/src/tools/search.ts`
- Create: `packages/mcp-gateway/src/tools/invoke.ts`
- Create: `packages/mcp-gateway/src/tools/fetch.ts`
- Test: `packages/mcp-gateway/test/gateway.test.ts`
- Test: `packages/mcp-gateway/test/protocol.test.ts`

**Interfaces:**
- Consumes: upstream MCP server configuration, `ResultStore`, `TokenLeafEngine` and projectors.
- Produces: compact `search_tools`, `invoke_tool` and `fetch_result` tools.

- [ ] **Step 1: Write an in-memory fake upstream MCP server**

It exposes 50 tools, one 2 MiB JSON result, pagination and a `list_changed` notification.

- [ ] **Step 2: Write failing gateway behavior tests**

Assert that search returns only compact summaries, invocation stores the original result, fetch selects a page, and ledger measurements cover schemas and results.

- [ ] **Step 3: Implement catalog indexing and stable namespaces**

Tool names are keyed by upstream ID plus original name. Collisions are errors, not last-write-wins behavior.

- [ ] **Step 4: Implement invocation limits**

Enforce timeout, cancellation, maximum input size, maximum captured output and configured upstream allowlist.

- [ ] **Step 5: Run official MCP conformance tests**

Run the active suite against the gateway server. Expected: all applicable active server checks pass; unsupported optional capabilities are not advertised.

- [ ] **Step 6: Commit**

```bash
git add packages/mcp-gateway
git commit -m "feat: proxy MCP tools through compact searchable gateway"
```

### Task 8: Build the risk-adaptive Rigor Gate runtime

**Files:**
- Create: `packages/workflow-runtime/src/risk.ts`
- Create: `packages/workflow-runtime/src/gates.ts`
- Create: `packages/workflow-runtime/src/state.ts`
- Create: `packages/workflow-runtime/src/runtime.ts`
- Test: `packages/workflow-runtime/test/risk.test.ts`
- Test: `packages/workflow-runtime/test/runtime.test.ts`

**Interfaces:**
- Produces: `classifyTask(input): RiskAssessment`, `selectGates(assessment)` and `WorkflowState` persisted as compact JSON.

- [ ] **Step 1: Encode the risk table as failing table-driven tests**

Auth, payment, destructive migration and secret handling always produce critical risk. Typos remain trivial unless they touch generated security policy or release metadata.

- [ ] **Step 2: Implement deterministic first-pass classification**

Use repository signals and explicit user intent. Do not call an LLM in the MVP classifier. Return matched rules and allow an upward user override; downward overrides require an explicit reason.

- [ ] **Step 3: Implement gate state transitions**

Invalid transitions fail closed. Verification and critical approvals cannot be marked complete without evidence identifiers. The runtime records `required`, `executed`, `passed` and `skipped-with-reason` separately so a short workflow cannot masquerade as a complete one.

- [ ] **Step 4: Test compact serialization**

The workflow state contains decisions, evidence handles and status, not full conversation transcripts.

- [ ] **Step 5: Commit**

```bash
git add packages/workflow-runtime
git commit -m "feat: select engineering gates from task risk"
```

### Task 9: Validate and route portable skills

**Files:**
- Create: `packages/skill-router/src/discover.ts`
- Create: `packages/skill-router/src/manifest.ts`
- Create: `packages/skill-router/src/provenance.ts`
- Create: `packages/skill-router/src/router.ts`
- Test: `packages/skill-router/test/manifest.test.ts`
- Test: `packages/skill-router/test/router.test.ts`

**Interfaces:**
- Produces: `discoverSkills(root)`, `validateSkill(path)`, `routeSkills(task, risk, budget)` and provenance diagnostics.

- [ ] **Step 1: Write fixtures for valid, conflicting and unsafe skills**

Include missing licenses, duplicate names, context-budget overflow, script capability mismatch and circular dependencies.

- [ ] **Step 2: Implement Agent Skills compatibility**

Parse required standard frontmatter without requiring `leanrigor.yaml`. Validate the sidecar only when present.

- [ ] **Step 3: Implement bounded routing**

Select the smallest skill set satisfying risk gates and dependencies. Return a conflict instead of loading two skills that define incompatible mandatory workflows.

- [ ] **Step 4: Implement provenance validation**

Copied or adapted artifacts require a source URL, license identifier and notice path. Independently authored artifacts may record influences without claiming copied files.

- [ ] **Step 5: Commit**

```bash
git add packages/skill-router
git commit -m "feat: validate provenance and route portable skills"
```

### Task 10: Author and evaluate the three initial skills

**Files:**
- Create: `skills/product-brainstorming/SKILL.md`
- Create: `skills/product-brainstorming/leanrigor.yaml`
- Create: `skills/product-brainstorming/provenance.yaml`
- Create: `skills/senior-system-design/SKILL.md`
- Create: `skills/senior-system-design/references/nfr-checklist.md`
- Create: `skills/senior-system-design/leanrigor.yaml`
- Create: `skills/senior-system-design/provenance.yaml`
- Create: `skills/verification/SKILL.md`
- Create: `skills/verification/leanrigor.yaml`
- Create: `skills/verification/provenance.yaml`
- Create: `evals/skills/*.yaml`

**Interfaces:**
- Consumes: standard Agent Skills loader and LeanRigor sidecar.
- Produces: three portable, independently authored workflow skills.

- [ ] **Step 1: Write evaluation cases before skill prose**

Each skill receives at least five positive cases, three non-trigger cases and deterministic artifact checks. System design cases require explicit NFRs, capacity assumptions, failure modes, security boundaries, observability and rollout.

- [ ] **Step 2: Run baselines without the skills**

Store model, host, version, seed where supported, usage mode, output hashes and verifier results.

- [ ] **Step 3: Author minimal decision-oriented skills**

Do not copy third-party prose. Convert researched principles into concise branching rules, required outputs and verification criteria. Update provenance manifests.

- [ ] **Step 4: Run with-skill and ablation evaluations**

Remove each major section in turn to identify which instructions improve pass rate. Delete sections that consume context without measurable value.

- [ ] **Step 5: Commit**

```bash
git add skills evals/skills provenance
git commit -m "feat: add three evaluated engineering skills"
```

### Task 11: Add reversible Claude Code and Codex installers

**Files:**
- Create: `packages/host-claude/src/adapter.ts`
- Create: `packages/host-claude/test/adapter.test.ts`
- Create: `packages/host-codex/src/adapter.ts`
- Create: `packages/host-codex/test/adapter.test.ts`
- Create: `packages/cli/src/commands/init.ts`
- Create: `packages/cli/src/commands/doctor.ts`
- Test: `packages/cli/test/init.test.ts`

**Interfaces:**
- Produces: `HostAdapter.detect()`, `planInstall()`, `applyInstall()` and `uninstall()`.

- [ ] **Step 1: Test installation plans against fixture home directories**

Plans must show exact creates and edits, preserve unrelated settings and write backups before mutation.

- [ ] **Step 2: Implement host-specific configuration writers**

Do not pretend hooks are portable. Each adapter owns its actual files and supported lifecycle capabilities.

- [ ] **Step 3: Implement doctor diagnostics**

Check Node version, executable resolution, configuration parse, MCP startup, skill discovery, data-directory permissions and telemetry state.

- [ ] **Step 4: Test install-uninstall round trips**

The fixture directory must be byte-identical to its original state after uninstall except for an append-only LeanRigor audit record.

- [ ] **Step 5: Commit**

```bash
git add packages/host-claude packages/host-codex packages/cli/src/commands packages/cli/test
git commit -m "feat: install leanrigor into claude code and codex"
```

### Task 12: Implement environmental estimate ranges

**Files:**
- Create: `packages/energy-estimator/src/model.ts`
- Create: `packages/energy-estimator/src/assumptions.ts`
- Create: `packages/energy-estimator/src/estimate.ts`
- Create: `packages/energy-estimator/data/methodology-v1.json`
- Test: `packages/energy-estimator/test/estimate.test.ts`
- Create: `docs/environmental-methodology.md`

**Interfaces:**
- Produces: `estimateEnergy(input): EstimateRange` with low, central, high, unit, methodology version and assumptions.

- [ ] **Step 1: Test that unknown models widen rather than fabricate precision**

Unknown model family returns a broad range and no carbon result unless grid intensity is supplied.

- [ ] **Step 2: Implement prefill/decode-separated equations**

Store coefficients in the versioned data file with source citations and retrieval dates. Code never embeds unexplained constants.

- [ ] **Step 3: Add copy-safety tests**

Snapshot all user-visible labels and reject strings containing “exact CO2 saved”, “trees saved” or “datacenter measured” for estimator output.

- [ ] **Step 4: Commit**

```bash
git add packages/energy-estimator docs/environmental-methodology.md
git commit -m "feat: report disclosed environmental estimate ranges"
```

### Task 13: Build the optional anonymous telemetry collector

**Files:**
- Create: `apps/telemetry-api/src/schema.ts`
- Create: `apps/telemetry-api/src/app.ts`
- Create: `apps/telemetry-api/src/aggregate.ts`
- Test: `apps/telemetry-api/test/app.test.ts`
- Create: `packages/cli/src/commands/telemetry.ts`
- Create: `docs/privacy.md`

**Interfaces:**
- Consumes: strict `AggregateTelemetryEvent`.
- Produces: `POST /v1/events`, `GET /v1/totals`, and CLI consent/inspection commands.

- [ ] **Step 1: Write rejection tests**

Reject prompts, file paths, repository names, arbitrary metadata, duplicate IDs, negative values and values over documented caps.

- [ ] **Step 2: Implement local consent and exact payload preview**

No network request occurs before `telemetry enable`. Tests replace the network transport and assert zero calls in default state.

- [ ] **Step 3: Implement minimal aggregation**

Persist daily aggregates and a bounded deduplication key. Public totals are labeled community-reported. Raw events follow the documented short retention period.

- [ ] **Step 4: Run privacy regression tests**

Generate random secrets and paths and assert none appear in outbound serialized payloads or server logs.

- [ ] **Step 5: Commit**

```bash
git add apps/telemetry-api packages/cli/src/commands/telemetry.ts docs/privacy.md
git commit -m "feat: add opt-in aggregate savings telemetry"
```

### Task 14: Create the benchmark harness and release gate

**Files:**
- Create: `packages/benchmark/src/case.ts`
- Create: `packages/benchmark/src/runner.ts`
- Create: `packages/benchmark/src/compare.ts`
- Create: `packages/benchmark/src/release-gate.ts`
- Test: `packages/benchmark/test/release-gate.test.ts`
- Create: `evals/context/*.json`
- Create: `evals/workflows/*.yaml`
- Create: `packages/cli/src/commands/benchmark.ts`

**Interfaces:**
- Produces: reproducible baseline/candidate results and `evaluateReleaseGate(report)`.

- [ ] **Step 1: Test the gate with passing and misleading reports**

Reports with high savings and failed tasks must fail. Reports with fewer than 90% completed cases fail. Pass-rate delta below -2 percentage points fails.

- [ ] **Step 2: Implement deterministic fixture runners**

MVP fixtures cover JSON, logs, diffs, repeated resources and 10/50/200-tool catalogs. Record environment and package versions.

- [ ] **Step 3: Implement baseline/candidate comparison**

Pair by case ID and run ID. Never compare unrelated runs or sum incompatible measurement modes.

- [ ] **Step 4: Add report export**

Emit JSON for CI, Markdown for releases and a terminal summary. Every percentage links to its case count and measurement mode.

- [ ] **Step 5: Commit**

```bash
git add packages/benchmark evals packages/cli/src/commands/benchmark.ts
git commit -m "feat: gate releases on quality-adjusted context savings"
```

### Task 15: Complete quality-first CLI reports and share artifacts

**Files:**
- Create: `packages/cli/src/commands/report.ts`
- Create: `packages/cli/src/render/terminal.ts`
- Create: `packages/cli/src/render/share-svg.ts`
- Test: `packages/cli/test/report.test.ts`
- Test: `packages/cli/test/share-svg.test.ts`

**Interfaces:**
- Consumes: TokenLeaf Engine, Rigor Gate, benchmark and optional energy reports.
- Produces: terminal, JSON, Markdown and local SVG output.

- [ ] **Step 1: Write snapshots for all measurement modes**

Snapshots must lead with verified outcome and required-gate coverage, then show context and token savings with estimator labels. Environmental output is hidden until explicitly enabled.

- [ ] **Step 2: Implement deterministic SVG generation**

Escape all strings, use bundled fonts or system-safe fallbacks, and include no remote assets or tracking pixels.

- [ ] **Step 3: Add secret and path scans**

The share artifact generator accepts only typed aggregate report objects; tests ensure fixture paths and secrets never appear.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/commands/report.ts packages/cli/src/render packages/cli/test
git commit -m "feat: render transparent leanrigor savings reports"
```

### Task 16: Prepare documentation and npm trusted publishing

**Files:**
- Create: `README.md`
- Create: `SECURITY.md`
- Create: `GOVERNANCE.md`
- Create: `CODE_OF_CONDUCT.md`
- Create: `docs/getting-started.md`
- Create: `docs/measurement-boundaries.md`
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`
- Create: `.github/dependabot.yml`
- Modify: `packages/cli/package.json`

**Interfaces:**
- Produces: installable public npm package `leanrigor` with the tagline “Less context. Full engineering rigor.” and a documented release process.

- [ ] **Step 1: Write README around a reproducible first-session demo**

Lead with the quality-first contract: required engineering gates are preserved, savings count only for passing tasks, and every estimate states its scope. Then include installation, supported hosts, privacy defaults, benchmark command, uninstall and current limitations before advanced architecture.

- [ ] **Step 2: Configure CI with least privilege**

CI runs build, typecheck, tests, MCP conformance, package-content inspection and benchmark smoke tests on Node 22/24 and three operating systems. Pin third-party actions to immutable commit SHAs.

- [ ] **Step 3: Configure npm trusted publishing**

The release job uses GitHub OIDC with `id-token: write`, no stored npm token, protected environment approval and npm provenance. Initial scoped subpackages use `--access public` only when they become public.

- [ ] **Step 4: Inspect the final tarball**

Run:

```bash
npm ci
npm run build
npm test
npm run typecheck
npm pack --workspace packages/cli --dry-run
```

Expected: all checks pass and no source maps containing local paths, fixtures with secrets, private docs or telemetry data are packed.

- [ ] **Step 5: Publish a release candidate**

Publish `leanrigor@0.1.0-rc.1` with the `next` dist-tag through the protected workflow. Install it in clean Linux, macOS and Windows environments using `npx leanrigor@next doctor`.

- [ ] **Step 6: Promote the verified artifact**

After the release gate and clean-install matrix pass, promote the same version to `latest`; do not rebuild different bytes locally.

- [ ] **Step 7: Commit**

```bash
git add README.md SECURITY.md GOVERNANCE.md CODE_OF_CONDUCT.md docs .github packages/cli/package.json
git commit -m "release: prepare leanrigor npm publication"
```

### Task 17: Run the public launch and extension program

**Files:**
- Create: `docs/extensions/projector-guide.md`
- Create: `docs/extensions/host-adapter-guide.md`
- Create: `docs/extensions/skill-pack-guide.md`
- Create: `.github/ISSUE_TEMPLATE/projector.yml`
- Create: `.github/ISSUE_TEMPLATE/host-adapter.yml`
- Create: `.github/ISSUE_TEMPLATE/skill-pack.yml`
- Create: `.github/pull_request_template.md`

**Interfaces:**
- Produces: bounded, substantive ownership paths for external maintainers.

- [ ] **Step 1: Document acceptance contracts**

Projectors need golden fixtures and reversibility policy; adapters need install/uninstall round-trip tests; skills need provenance, positive/non-trigger evals and token-budget reports.

- [ ] **Step 2: Seed twelve scoped issues**

Create issues for CSV projector, JUnit projector, GitHub Actions log projector, npm test projector, Gemini adapter, OpenCode adapter, Windows installer hardening, self-hosted telemetry storage, energy methodology review, RAG system-design evals, marketplace system-design evals and e-commerce system-design evals.

- [ ] **Step 3: Publish launch evidence**

Release the raw benchmark fixtures, versions, failed cases and reproduction commands together with the 30-second demo. Do not use a universal energy claim in the headline.

- [ ] **Step 4: Track community health**

Monthly report includes unique active maintainers, review latency, bus factor, substantive merged changes, npm dependents, benchmark users and unresolved security issues.

- [ ] **Step 5: Commit**

```bash
git add docs/extensions .github/ISSUE_TEMPLATE .github/pull_request_template.md
git commit -m "docs: open bounded leanrigor extension paths"
```

## Milestone schedule

| Milestone | End week | Exit evidence |
|---|---:|---|
| M0 Measurement foundation | 2 | CLI, schemas and reproducible baseline fixtures |
| M1 TokenLeaf Engine | 6 | measurement engine, store and three deterministic projectors |
| M2 MCP alpha | 8 | searchable gateway passes applicable conformance tests |
| M3 Rigor Gate beta | 10 | risk gates, evidence coverage and both host installers pass round trips |
| M4 Verified skills | 11 | three skills show measured uplift or neutral quality with lower context |
| M5 npm launch | 12 | `leanrigor@latest`, provenance, clean-install matrix and public benchmark |
| M6 Community | 16 | five external maintainers own accepted extension surfaces |
| M7 Ecosystem | 24 | twenty unique external maintainers and third host adapter |

## Plan self-review

- Spec coverage: measurement, gateway, workflow, skills, adapters, telemetry, environment estimates, benchmark, npm and community paths each map to tasks.
- Placeholder scan: every task, interface, command and expected result is concrete; no unfinished marker remains.
- Type consistency: measurement modes, ledger events, telemetry events, result handles and host-adapter contracts match the design.
- Scope check: the MVP does not implement a model loop, cloud marketplace, persistent memory or generic multi-agent orchestration.
