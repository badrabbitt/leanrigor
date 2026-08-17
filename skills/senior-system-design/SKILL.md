---
name: senior-system-design
description: Use when designing or reviewing a system, service, migration or cross-component feature — anything where load, failure, data shape, security boundaries or rollout matter. Produces a design with explicit non-functional requirements, capacity assumptions, failure modes, security boundaries, observability and a rollout plan.
license: Apache-2.0
---

# Senior system design

A design is a set of decisions with stated consequences. Prose that describes
components without deciding anything is not a design.

Work through the sections below. Each one must end in a decision or an
explicitly recorded unknown. `references/nfr-checklist.md` holds the detailed
prompts; consult it when a section feels thin.

## 1. Functional requirements
What the system must do, as capabilities a caller can invoke. Number them so the
rest of the document can refer to them.

## 2. Non-functional requirements
State numbers, not adjectives. Required: request rate, data volume, latency
target and the percentile it applies to, availability target, durability
expectation, consistency model, retention. "Fast" and "reliable" are not
requirements.

## 3. Capacity assumptions
Show the arithmetic: requests per second, bytes per record, records per day,
storage at one year, peak-to-average ratio. Label every input as measured,
estimated or assumed. A capacity section with no arithmetic is a guess wearing
a suit.

## 4. Data
Entities, ownership, access patterns, indexes implied by those patterns, and the
migration path from what exists today. Say which component owns each write.

## 5. Failure modes
For each dependency: what happens when it is slow, when it is down, and when it
returns wrong data. Then decide, per call: timeout, retry policy with backoff and
jitter, retry budget, idempotency, and what the caller sees when you give up.
Retries without a budget turn one failure into an outage.

## 6. Security boundaries
Where trust changes hands. For each boundary: what authenticates the caller,
what authorizes the action, what is validated, what is logged, and what must
never be logged. Name where secrets live and how they rotate.

## 7. Observability
The signals that would let someone diagnose this at 3am: the SLI and its target,
the alert that fires when users are affected — not when a machine is busy — the
dashboard, and the trace or log field that ties a user report to a request.

## 8. Cost
The dominant cost driver and roughly what it scales with. A design that is right
and unaffordable is not right.

## 9. Rollout and rollback
Order of deployment, compatibility during the window when both versions run,
the flag or toggle, what is migrated and when, and the exact rollback step. If
rollback is impossible after a point, say where that point is.

## Choosing between options

Where a real choice exists, state at least two options and pick one on a named
criterion. Record what would change the decision. A design that presents one
option has hidden its reasoning rather than shown it.

## Anti-patterns

- Adjectives instead of numbers in the NFR section.
- A component diagram with no decisions attached.
- Failure handling reduced to "retry".
- Alerts on CPU rather than on user-visible symptoms.
- No rollback step, or a rollback step that has never been thought through.
