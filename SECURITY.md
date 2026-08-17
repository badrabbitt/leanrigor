# Security policy

## Reporting a vulnerability

Report privately through GitHub's [security advisory
form](https://github.com/badrabbitt/leanrigor/security/advisories/new). Please do
not open a public issue for a vulnerability.

Include what you can: affected version, reproduction steps, and impact. A
proof-of-concept is welcome but not required to report.

**Response targets.** Acknowledgement within 3 working days; an initial
assessment within 10. These are targets for a small project, not a contractual
SLA, and they will be stated honestly if missed.

## Supported versions

Only the latest published `leanrigor` release receives fixes while the project
is pre-1.0.

## Scope

In scope:

- The `leanrigor` npm package and its command-line surface.
- The MCP gateway, including its HTTP transport and Host/Origin validation.
- The content-addressed result store, including handle validation and path
  handling.
- The optional telemetry collector in `apps/telemetry-api`.
- Any path by which prompts, source code, file paths or payloads could leave the
  machine, or reach a log or a share artifact.

Out of scope:

- Vulnerabilities in upstream MCP servers you configure yourself.
- Vulnerabilities in the coding-agent host.
- Findings that require an attacker to already control the user's account or
  filesystem.

## Design commitments relevant to security

- The gateway binds to loopback and validates `Host` and `Origin` on every HTTP
  request, guarding against DNS rebinding
  ([GHSA-w48q-cv73-mx4w](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-w48q-cv73-mx4w)).
  This was found by the official MCP conformance suite and fixed before release.
- Only explicitly configured upstream commands are launched. LeanRigor does not
  discover or execute commands found in a repository.
- Only environment variables named in `envPassthrough` reach an upstream server.
- Content handles admit 64 lowercase hex characters and nothing else, so a
  handle cannot carry a path traversal. Content is re-verified against its hash
  on every read.
- Skill scripts must declare network, shell, filesystem and secret capabilities.
  Static detection is a review aid, not a sandbox — LeanRigor does not execute
  skill scripts on the strength of it.
- Credentials are read only from documented environment variables and are never
  placed in a URL, an error message or an error's structured details.

## Supply chain

- Dependencies are lockfile-pinned; GitHub Actions are pinned to commit SHAs.
- Releases publish through GitHub OIDC trusted publishing with npm provenance,
  from a protected environment.
- `npm pack --dry-run` output is inspected before every release.
