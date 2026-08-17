---
name: product-brainstorming
description: Use before building a feature, product or component when the problem, users or scope are not yet settled — including requests phrased as "build X", "add X" or "we need X" that have not stated who it is for or what breaks without it. Produces a scoped brief, not an implementation.
license: Apache-2.0
---

# Product brainstorming

A request names a solution. This skill recovers the problem behind it, so the
solution can be judged rather than merely built.

## When to stop and use this

Use it when any of these is unknown: who has the problem, what they do today,
what "better" means, or what is out of scope. Skip it when the user has already
answered those, or when the task is a defect fix with a known correct behaviour.

## Produce this brief

Write it to `product-brief.md`. Six sections, each short. An empty section is a
finding, not a gap to fill with plausible text.

### 1. Problem
What goes wrong today, for whom, how often. Written so someone who disagrees
could point at the sentence they dispute.

### 2. Users
Who has this problem. Distinguish the person who feels the pain from the person
who chooses the tool — they are often different, and they want different things.

### 3. Current behaviour
What they do now, including the workaround they already have. A workaround that
is good enough is the strongest argument against building anything.

### 4. Alternatives
At least three: do nothing, the smallest change, and the requested solution.
State what each costs and what it fails to solve. If the requested solution does
not win, say so.

### 5. Scope
In scope, out of scope, and explicitly deferred. Out-of-scope items are named,
not omitted — an unnamed exclusion reappears as a surprise.

### 6. Validation
The observation that would show this worked, and the observation that would show
it did not. Both must be things you could actually see.

## How to ask

Ask the smallest number of questions that would change the design, one topic at
a time. Do not present a questionnaire. When you can answer a question from the
repository or the conversation, answer it yourself and say what you assumed.

**Asking is not a substitute for the brief.** If nobody answers — because the
session is non-interactive, or the person is not there — write the brief anyway
from what you have, and record each unknown as a stated assumption. A question
left hanging produces nothing; a brief with three explicit assumptions can be
corrected.

## Disagreement is part of the job

If the brief shows the requested solution is wrong for the stated problem, say
so in one or two sentences, then continue: produce the brief for the request as
given, with the concern recorded. The decision belongs to the user.

## Anti-patterns

- Inventing users, numbers or pain that nobody stated.
- Listing alternatives that were never real, to make one option look inevitable.
- A validation section that cannot fail.
- Sliding into implementation while the problem is still open.
