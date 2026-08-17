# Third-Party Notices

LeanRigor original code is licensed under Apache-2.0 (see `LICENSE`).

This file is the project's **reuse ledger**. It records every third-party file,
code fragment or block of prose that has been copied or adapted into this
repository, together with the notices that license requires us to retain.

## Reuse rules

1. A source listed in `02-research-source-catalog.md` is **not** pre-approved for
   copying. Listing means "may be studied".
2. Copying or adapting any third-party file requires an entry in the table below
   **and** a matching `provenance/<artifact>.yaml` record before merge.
3. Independently authored artifacts that were merely *influenced* by public work
   are recorded in `provenance/`, not here — this file is for retained notices.
4. Copyleft-licensed code is kept out of the distributed packages.
5. Source-available and unlicensed material is never used as an implementation
   source.

## Copied or adapted material

| Artifact in this repository | Upstream source | Upstream version / commit | License | Notice retained |
|---|---|---|---|---|
| _(none)_ | — | — | — | — |

No third-party source code or prose has been copied into this repository. All
implementation is independently authored.

## Runtime and build dependencies

LeanRigor depends on third-party npm packages at build and run time. Those
packages are not vendored into this repository; their licenses ship with the
packages themselves and can be inspected with:

```bash
npm ls --all
```

The distributed `leanrigor` package bundles no third-party source. Dependencies
are declared in `package.json` and resolved by npm at install time.
