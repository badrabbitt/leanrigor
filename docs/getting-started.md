# Getting started

## Requirements

Node.js 22 or newer. Nothing else — no account, no API key, no service.

## Install

```bash
npx leanrigor init
```

`init` detects supported hosts, prints **every file it would create or modify**
with the exact resulting contents, and stops. Nothing is written until you
confirm.

To see the plan without any possibility of a write:

```bash
npx leanrigor init --dry-run
```

To install without a prompt, in CI or a script:

```bash
npx leanrigor init --yes
```

## Check the installation

```bash
npx leanrigor doctor
```

```text
LeanRigor doctor

  [ok  ] node version     v22.14.0 (minimum v22)
  [ok  ] data directory   /path/to/project/.leanrigor is writable
  [ok  ] configuration    no config file; built-in defaults are in use
  [ok  ] mcp gateway      loadable; exposes 4 tools
  [ok  ] skills           0 valid skill(s) discovered
  [ok  ] hosts            detected claude-code
  [ok  ] telemetry        disabled (default); nothing is sent
```

A check that could not run reports `warn` or `FAIL`. It never reports `ok`
when it is uncertain.

## Point the gateway at your MCP servers

`init` registers `leanrigor mcp serve` with your host. To have the gateway proxy
your existing MCP servers, list them in `.leanrigor/config.json`:

```json
{
  "schemaVersion": 1,
  "dataDir": "/absolute/path/to/project/.leanrigor",
  "projectId": "default",
  "telemetry": { "enabled": false },
  "store": { "ttlDays": 7, "maxBytes": 1073741824 },
  "measurement": {
    "preferredMode": "tokenizer-estimate",
    "estimator": "cl100k-compatible@1",
    "allowByteOnlyFallback": true
  },
  "energy": { "enabled": false, "methodologyVersion": "v1" },
  "gateway": {
    "requestTimeoutMs": 60000,
    "maxCapturedResultBytes": 67108864,
    "maxProjectedResultBytes": 16384
  },
  "upstreamServers": [
    {
      "id": "github",
      "transport": "stdio",
      "command": "github-mcp-server",
      "args": ["stdio"],
      "envPassthrough": ["GITHUB_TOKEN"],
      "enabled": true
    }
  ]
}
```

Only the commands you list here are ever launched, and only the environment
variables you name in `envPassthrough` are forwarded.

Your host now sees four tools — `search_tools`, `describe_tool`, `invoke_tool`
and `fetch_result` — no matter how many tools your upstream servers expose.

## Install the skills

```bash
npx leanrigor skills install verification
npx leanrigor skills list
```

```text
/path/to/project/.leanrigor/skills
  ok    verification    trivial, low, medium, high, critical  (1200 token budget)
```

Three are bundled: `verification`, `product-brainstorming` and
`senior-system-design`.

## See what was saved

```bash
npx leanrigor report
```

The report leads with the verified outcome and gate coverage, then the savings,
each labelled with the measurement mode that produced it.

For a shareable card containing aggregate counts only:

```bash
npx leanrigor report --share
```

## Run the benchmark yourself

```bash
npx leanrigor benchmark
```

It runs the deterministic corpus in `evals/` and prints both the comparison and
the release-gate verdict, because a reduction figure without its quality verdict
is exactly the number this project exists to stop people publishing.

## Uninstall

```bash
npx leanrigor init --uninstall
```

Modified files are restored to their original bytes; files LeanRigor created are
removed. An append-only audit record stays under `.leanrigor/`.
