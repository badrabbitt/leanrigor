# Privacy

LeanRigor is local-first. It needs no account, and by default it makes no
network request of its own.

## Defaults

| Behaviour | Default |
|---|---|
| Telemetry | **Off.** Nothing is sent until you run `leanrigor telemetry enable` |
| Account | Not required, and there is nowhere to create one |
| Prompt, source and tool payload storage on a LeanRigor server | **Never**, at any setting |
| Tool payload logging on your machine | Off unless you enable debug mode |
| Result store | Local only, scoped per project, garbage-collected by age and size |

## What stays on your machine

Everything LeanRigor handles. Tool results are written to a content-addressed
store under your project's data directory, keyed by their own SHA-256 digest,
and never leave it. The ledger records byte counts, token estimates and pass/fail
verdicts — the schema is a strict object with no payload field, so a prompt or a
file path cannot end up there even by accident
(`packages/core/src/measurement.ts`).

## If you enable telemetry

You get exactly this, and you can print it before deciding:

```bash
npx leanrigor telemetry inspect
```

```json
{
  "schemaVersion": 1,
  "eventId": "…",
  "anonymousInstallId": "…",
  "day": "2026-08-17",
  "host": "claude-code",
  "measurementMode": "byte-only",
  "baselineBytes": 2804112,
  "optimizedBytes": 611420,
  "verifiedTasks": 8,
  "passedTasks": 8,
  "clientVersion": "0.1.0"
}
```

That is the whole payload. There is no metadata bag, no tags field and no notes
field — the server rejects any unknown field outright, and tests assert that
prompts, file paths, repository names, source code and tool payloads are all
rejected (`apps/telemetry-api/test/app.test.ts`).

The install id is a random UUID generated when you enable telemetry. It is not
derived from your machine, your account, your email or your repository, and it
is not generated at all until you consent.

## What the server does

- Rejects unknown fields and values above documented caps.
- Deduplicates by event id.
- Rate limits per install id and per source address.
- Uses the source address for abuse control only, then drops it. It is never
  stored beside an event and never appears in an aggregate.
- Folds each event into a daily bucket keyed by day, host and measurement mode,
  then discards the raw event.
- Publishes its retention window and methodology at `/v1/methodology`.
- Labels every public total **community-reported**, never provider-verified.

You can self-host it. `apps/telemetry-api` is in this repository, and the client
accepts any endpoint, including `http://127.0.0.1` on the loopback interface.

## Commands

```bash
npx leanrigor telemetry status
npx leanrigor telemetry inspect
npx leanrigor telemetry enable
npx leanrigor telemetry disable
```

## Configuration edits

`leanrigor init` previews every file change before writing anything, backs up any
file it modifies, and `leanrigor init --uninstall` restores the original bytes.
The only thing left behind is an append-only audit record under `.leanrigor/`.

## Upstream MCP servers

LeanRigor launches only the servers you configure explicitly. It does not
discover or execute commands found in a repository, and it forwards only the
environment variables you name in `envPassthrough` — never your whole
environment.

## Local HTTP transport

When the gateway serves over HTTP it binds to the loopback interface and
validates the `Host` and `Origin` headers on every request, so a web page you
happen to visit cannot drive it via DNS rebinding
(see [GHSA-w48q-cv73-mx4w](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-w48q-cv73-mx4w)).

## Reporting a problem

See [SECURITY.md](../SECURITY.md).
