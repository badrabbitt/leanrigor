# Governance

## Current state, stated honestly

LeanRigor has **one maintainer**. The bus factor is 1. Everything below
describes how the project is intended to grow, not a structure that already
exists.

Maintainer: [@badrabbitt](https://github.com/badrabbitt).

## Decision making

Ordinary changes are decided in the pull request. Where reviewers disagree, the
tie-break is the project's stated priority order:

1. **Correctness and safety of the user's work.** A change that saves context
   and weakens a required gate is rejected, whatever the numbers say.
2. **Honesty of measurement.** A change that makes a number look better without
   making it truer is rejected.
3. **Context efficiency.** The optimization objective, inside the constraints
   above.
4. **Everything else** — ergonomics, breadth, features.

If a change is contested and none of the above resolves it, the maintainer
decides and records the reasoning in the pull request.

## Becoming a maintainer

There is no application. The path is: land substantive work, review other
people's work well, and be reachable. After roughly five meaningful merged
contributions and a demonstrated willingness to review, a maintainer proposes
commit access in a public issue. Any existing maintainer may object with
reasons; an unresolved objection blocks it.

Areas are ownable independently of the core. Owning
`packages/result-store/src/projectors/`, a host adapter or a skill pack does not
require reviewing the measurement engine.

## Maintainer responsibilities

- Review within a week, or say you cannot.
- Do not merge your own non-trivial change without another reviewer, once there
  is another reviewer to ask.
- Uphold the release gate. A release that fails the quality bar does not
  advertise savings, whatever the launch schedule says.
- Keep provenance honest: no third-party code or prose without a license review
  and a retained notice.

## Releases

Releases publish through GitHub OIDC trusted publishing from a protected
environment. Publishing requires:

- the full test suite passing on Node 22 and 24, on Linux, macOS and Windows;
- the MCP conformance suite passing against its reviewed baseline;
- the benchmark release gate passing;
- an inspected `npm pack --dry-run` output;
- a clean-install check of the published artifact.

A release may ship without being allowed to advertise savings. Those are two
separate verdicts and the gate reports them separately.

## Adding a dependency

Argue for it in the pull request: what it does, why writing it is worse, its
license, its maintenance state, and its install weight. Dependencies that reach
the network at import time, or that require a native build, need a strong case.

## Changing the measurement rules

Any change to what counts as a saving, what a measurement mode means, or what
the release gate requires needs an explicit review by a maintainer other than
the author, once that is possible. These rules are the product.

## Contact

Open an issue for anything public. For security, use a
[private advisory](https://github.com/badrabbitt/leanrigor/security/advisories/new).
