# Writing a skill pack

A skill is a portable Agent Skills folder. LeanRigor adds an optional sidecar for
routing, budgeting and provenance — and the sidecar must remain optional, so the
skill still works in agents that know nothing about LeanRigor.

## Layout

```text
skills/<name>/
├── SKILL.md          required, standard Agent Skills frontmatter
├── leanrigor.yaml    optional sidecar
├── provenance.yaml   required if the sidecar points at one
└── references/       loaded on demand, not with the skill
```

## The rules

1. **A bounded trigger.** The `description` states when the skill applies *and*
   implies when it does not. A description that matches everything wastes
   context on every task.
2. **A declared budget.** `context_budget_tokens` must be honest. There is a test
   asserting each shipped skill fits its own declared budget.
3. **Decisions, not prose.** Convert a principle into a branching rule with a
   required output. "Consider reliability" earns nothing; "state the retry
   budget, or record that there is none" changes behaviour.
4. **Never copy third-party prose.** Write the rule independently and record the
   influence in `provenance.yaml`. Anything actually copied needs a source URL,
   a license identifier and a retained notice — the validator enforces this.
5. **Declare script capabilities.** A bundled script that reaches the network,
   the shell, the filesystem or a secret must say so. Static detection will
   reject an undeclared one.
6. **Progressive disclosure.** Detail belongs in `references/`, loaded when
   needed, not in the body that costs context every time.

## Acceptance contract

- [ ] at least five positive evaluation cases
- [ ] at least three non-trigger cases, proving the description is bounded
- [ ] deterministic artifact checks — no model judging another model's prose
- [ ] an ablation section list naming real headings in the skill
- [ ] a `provenance.yaml` recording influences honestly
- [ ] a declared context budget the skill actually fits
- [ ] a license

## Evaluations

Cases live in `evals/skills/<name>.yaml`. The check vocabulary is documented in
[`evals/README.md`](../../evals/README.md).

**Ablation is where skills get better.** Remove each major section in turn and
re-run. A section that changes no outcome is deleted: it costs context and earns
nothing. This is the difference between a skill and a wish.

## What will be rejected

- A skill with no evaluation cases.
- A skill whose trigger description would fire on most tasks.
- Bulk-imported content from a skill collection, with no author and no
  evaluation trail.
- Anything copied without a license review and a retained notice.
- A skill that duplicates one already shipped without measurably beating it.
