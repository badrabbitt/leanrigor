# LeanRigor Research Source Catalog

**Date reviewed:** 2026-08-17  
**Product:** LeanRigor — Less context. Full engineering rigor.  
**Purpose:** Identify projects, specifications, skills and engineering literature to study before implementing LeanRigor and its internal TokenLeaf Engine.  
**Rule:** A listing here is not permission to copy. The exact version and license of every reused file must be reviewed at implementation time.

## Research lenses

Every candidate is evaluated against three independent questions:

1. **Efficiency:** Does it reduce irrelevant context, repeated instructions, tool schemas, payload bytes, calls or retries?
2. **Rigor:** Does it preserve the design, testing, security, review and verification gates appropriate to task risk?
3. **Outcome:** Does it improve or preserve deterministic task success, not merely shorten prompts?

Token-saving ideas feed the **TokenLeaf Engine**. Workflow, skill and harness ideas feed LeanRigor's **Rigor Gates** and **Verified Skills**. A candidate is not adopted when it improves token metrics while reducing verified outcomes.

## 1. Reuse labels

| Label | Meaning |
|---|---|
| Study | Learn concepts and behavior; write an independent specification and implementation |
| Interoperate | Use public protocol/API without copying implementation |
| Adapt with notice | Permissive license appears compatible; retain required notices and document changes |
| Test against | Treat the project as an external system or benchmark target |
| Exclude | Do not use as an implementation source |

## 2. Token and context efficiency

| Source | URL | Known license/status | Research focus | Planned use |
|---|---|---|---|---|
| Caveman | https://github.com/JuliusBrussee/caveman | MIT | Viral positioning, terse output, MCP schema shrink, token stats, cross-host installation | Study; benchmark against; do not copy brand or prose |
| Token Optimizer MCP | https://github.com/ooples/token-optimizer-mcp | Verify exact repository license before reuse | Cache, diff, smart reads, optimization reports | Study and test against |
| LLMLingua | https://github.com/microsoft/LLMLingua | MIT | Prompt compression, budget controller, compression-quality trade-off | Study; optional adapter with notices rather than porting blindly |
| LLMLingua-2 JS | https://github.com/atjsh/llmlingua-2-js | MIT notices for upstream logic | Existing JS/TS implementation and attribution pattern | Study packaging; do not make neural compression an MVP dependency |
| Anthropic effective context engineering | https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents | Article; research use | Context as finite resource, curation, compaction and memory | Study and cite in design rationale |
| Anthropic code execution with MCP | https://www.anthropic.com/engineering/code-execution-with-mcp | Article; research use | Load tools on demand and filter data before model context | Study; benchmark equivalent gateway behavior |
| Anthropic token counting | https://docs.anthropic.com/en/docs/build-with-claude/token-counting | Official API docs | Pre-request token measurement | Interoperate when user provides API credentials |
| Anthropic prompt caching | https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching | Official API docs | Cache-aware usage and billing distinctions | Study; preserve cache usage as a separate metric |
| OpenAI Agents SDK tool search | https://openai.github.io/openai-agents-js/guides/tools/ | Official docs and open SDK | Deferred tool loading and namespaces | Interoperate; use native deferred loading when supported |
| MCP tools specification | https://modelcontextprotocol.io/specification/2026-07-28/server/tools | Open specification | Tool listing, pagination and list changes | Implement protocol behavior and conformance tests |
| MCP resources specification | https://modelcontextprotocol.io/specification/2026-07-28/server/resources | Open specification | Resource listing, subscription and selective reads | Interoperate |
| MCP conformance | https://github.com/modelcontextprotocol/conformance | Open-source official tests | Client/server protocol compatibility | Run in CI; do not replace with a custom protocol test suite |

## 3. Skills, workflows and validation

| Source | URL | Known license/status | Research focus | Planned use |
|---|---|---|---|---|
| Agent Skills specification | https://agentskills.io/specification | Open standard | Portable folder layout and `SKILL.md` metadata | Implement compatibility; keep LeanRigor routing and evaluation metadata in sidecar |
| Anthropic skills repository | https://github.com/anthropics/skills | Mixed: examples Apache-2.0; document skills source-available | Progressive disclosure, skill structure, scripts/assets | Study per-directory license; do not copy source-available document skills |
| Superpowers | https://github.com/obra/superpowers | MIT | Brainstorming, planning, worktrees, TDD, review and verification gates | Study and benchmark; independently implement risk-adaptive workflow; preserve notices if any text/code is reused |
| Microsoft Waza | https://github.com/microsoft/waza | MIT | YAML skill evals, validators, model comparison, MCP mocks | Study and test interoperability; avoid duplicating generic skill evaluation |
| SkillsBench | https://arxiv.org/abs/2602.12670 | Research paper and associated artifacts | Baseline vs curated vs self-generated skill evaluation | Study experimental methodology |
| Addy Osmani agent-skills | https://github.com/addyosmani/agent-skills | MIT | Production engineering lifecycle, process over prose, progressive disclosure and scope discipline | Study; derive independent decision rules; notices required for copied text |
| wshobson/agents | https://github.com/wshobson/agents | MIT | Granular plugin architecture, canonical content plus host adapters | Study repository boundaries and adapter generation |
| alirezarezvani/claude-skills | https://github.com/alirezarezvani/claude-skills | MIT | Broad domain packs, zero-dependency scripts, cross-host conversion | Study taxonomy and maintenance costs; do not import bulk content |
| GitHub awesome-copilot | https://github.com/github/awesome-copilot | Per-file repository terms; verify | Community skills and architecture examples | Discovery and test corpus; inspect each artifact license |
| VoltAgent awesome-agent-skills | https://github.com/VoltAgent/awesome-agent-skills | Curated links, upstream licenses vary | Discovery of skill ecosystem and overlap | Discovery only |
| Skill validator | https://github.com/agent-ecosystem/skill-validator | Verify exact version license | Density, structure and keyword-stuffing checks | Study rules; integrate through adapter if compatible |

## 4. Harnesses and host adapters

| Source | URL | Known license/status | Research focus | Planned use |
|---|---|---|---|---|
| MetaHarness | https://github.com/ruvnet/metaharness | MIT | npm-publishable harness generation, host adapters, policy and provenance | Study; differentiate by measured context optimization |
| Yoke | https://github.com/HECer/yoke | Verify exact version license | Curated skills, safety gates, cross-agent review | Test against and study user experience |
| Open Harness | https://github.com/mifunedev/openharness | Verify exact version license | Docker isolation and persistent agent workspace | Study isolation; exclude containers from MVP |
| Harness Bench | https://github.com/zenixos/harness-bench | Verify exact version license | Fixed-model comparison of CLI harnesses | Study benchmark controls; potential downstream benchmark target |
| Agent VCR | https://github.com/Jarvis2021/agent-vcr | MIT according to repository description; verify tag | MCP record/replay/diff | Interoperate for deterministic tests instead of rebuilding VCR |
| OpenAI Agents SDK JS | https://openai.github.io/openai-agents-js/ | Official open SDK | Tool search, tracing, guardrails, sessions and MCP | Build optional SDK adapter; do not create another generic agent loop |
| Anthropic effective long-running harnesses | https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents | Article; research use | Progress files, fresh-agent handoffs and compaction limitations | Study workflow state design |
| Anthropic managed-agent scaling | https://www.anthropic.com/engineering/managed-agents | Article; research use | Harness assumptions becoming stale as models improve | Add versioned ablation tests and minimal intervention rule |

## 5. Senior system-design knowledge sources

These are research references, not content libraries to republish.

| Source | URL | Focus for the skill | Use rule |
|---|---|---|---|
| AWS Builders' Library | https://aws.amazon.com/builders-library/ | retries, timeouts, jitter, overload, queues, isolation and operational visibility | Convert principles into independently worded decision rules; link source |
| Google SRE books | https://sre.google/books/ | SLOs, error budgets, monitoring, incident response, capacity | Research and citations; respect book terms |
| Azure Architecture Center | https://learn.microsoft.com/en-us/azure/architecture/ | architecture styles, cloud patterns, reliability, security and performance trade-offs | Research patterns; link official pages |
| Azure AI agent orchestration patterns | https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns | sequential, concurrent, handoff, group-chat and maker-checker patterns | Encode selection criteria, not copied prose |
| Anthropic Building Effective Agents | https://www.anthropic.com/engineering/building-effective-agents | workflow versus agent distinction and simple composable patterns | Research and benchmark scenarios |
| Anthropic Writing Effective Tools | https://www.anthropic.com/engineering/writing-tools-for-agents | tool descriptions, prototyping and evaluation-driven improvement | Build MCP tool-quality checks |
| Anthropic Demystifying Evals | https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents | multi-turn evaluation design | Shape benchmark and verifier policy |
| Green Software Foundation SCI | https://github.com/Green-Software-Foundation/sci | transparent software carbon-intensity methodology | Study estimator disclosure and functional unit design |
| Green Software Foundation SCER | https://github.com/Green-Software-Foundation/scer | software carbon efficiency ratings | Study future reporting; not part of MVP scoring |

## 6. Environmental measurement research for TokenLeaf Engine

| Source | URL | Finding relevant to TokenLeaf Engine and LeanRigor |
|---|---|---|
| Compression Paradox in LLM Inference | https://arxiv.org/abs/2603.23528 | Prompt compression can reduce quality or expand output; token reduction alone is not a reliable energy proxy |
| From Tokens to Watt-hours | https://arxiv.org/abs/2607.26571 | Energy estimates should separate prefill and decoding and expose hardware assumptions |
| Energy Use of AI Inference | https://arxiv.org/abs/2509.20241 | Bottom-up estimates require throughput, utilization and PUE assumptions |
| Towards Green AI for Software Development | https://arxiv.org/abs/2602.05712 | Prefill affects decoding energy; suppressing unnecessary output can save energy without reducing accuracy in tested settings |
| IEA Energy and AI Observatory | https://www.iea.org/data-and-statistics/data-tools/energy-and-ai-observatory | Broad energy context; not a per-token conversion source |

## 7. npm and supply-chain references

| Source | URL | Planned use |
|---|---|---|
| npm scoped public packages | https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/ | Package visibility, review and publication checklist |
| npm trusted publishing | https://docs.npmjs.com/trusted-publishers/ | GitHub Actions OIDC without long-lived npm token |
| npm provenance | https://docs.npmjs.com/generating-provenance-statements/ | Attestation for published artifacts |
| npm package.json | https://docs.npmjs.com/cli/v12/configuring-npm/package-json/ | `bin`, `exports`, `files`, `engines` and metadata |
| npm workspaces | https://docs.npmjs.com/cli/v8/using-npm/workspaces/ | Monorepo package management |
| GitHub Actions supply-chain security | https://docs.github.com/actions/security-for-github-actions | Pinned actions, attestations and least privilege |

## 8. Projects explicitly excluded as implementation sources

- Leaked or accidentally published proprietary coding-agent source.
- Repositories without an identifiable license.
- Skill marketplaces that do not retain upstream license metadata.
- Generated “senior” skill collections with no authorship or evaluation trail.
- Blog posts that reproduce paid books or courses without permission.
- Packages whose npm artifact differs materially from the reviewed Git repository.

Unknown-license projects may still be run externally for black-box compatibility tests, but no source or text may enter LeanRigor.

## 9. Research workflow for each candidate

1. Pin repository URL, commit and retrieval date.
2. Read root license and any directory-level overrides.
3. Classify material as idea, API, code, prose, data or trademark.
4. Record only abstract principles during the first review.
5. Write an independent LeanRigor requirement, Rigor Gate or TokenLeaf Engine decision rule.
6. If copying is still useful, request human license review and retain notices.
7. Create baseline and candidate evaluations.
8. Keep the change only if quality-adjusted efficiency improves and all mandatory gates remain covered.
9. Update `provenance/<artifact>.yaml` before merge.
