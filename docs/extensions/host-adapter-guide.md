# Writing a host adapter

A host adapter installs LeanRigor into one coding-agent host, reversibly.

## The interface

```ts
interface HostAdapter {
  readonly host: string;
  detect(): Promise<HostDetection>;
  planInstall(): Promise<InstallPlan>;
  applyInstall(plan: InstallPlan): Promise<InstallResult>;
  uninstall(): Promise<UninstallResult>;
}
```

## The rules

1. **Plan before writing.** `planInstall` must not touch the filesystem. It
   returns the exact resulting contents of every file, so a user can read the
   diff and refuse.
2. **Back up before mutating.** The backup is written *before* the change, so a
   crash in between leaves the original recoverable.
3. **Preserve unrelated settings.** Parse and re-emit; never append blindly to
   someone's configuration file.
4. **Round-trip exactly.** After `uninstall`, the fixture directory must be
   byte-identical to its original state, except for the append-only audit
   record. There is a test for this and it is not negotiable.
5. **Do not claim capabilities the host lacks.** `HostCapability` is declared per
   adapter. Hooks and skill directories are not portable, and pretending they
   are produces installs that silently do nothing.
6. **Warn about what you cannot preserve.** The Codex adapter rewrites TOML,
   which drops comments; the plan says so rather than losing them quietly.

## Acceptance contract

- [ ] `detect()` tested against a fixture home directory, positive and negative
- [ ] `planInstall()` tested to write nothing (snapshot the directory before and
      after)
- [ ] preservation test: an existing unrelated setting survives the install
- [ ] round-trip test: install then uninstall restores the original bytes
- [ ] a test for the case where LeanRigor created the file, so uninstall removes it
- [ ] a test that uninstalling when nothing was installed is safe
- [ ] capabilities declared honestly, with a test asserting what is *not* claimed

## Where things go

```text
packages/host-<name>/src/adapter.ts
packages/host-<name>/test/adapter.test.ts
```

Register it in `packages/cli/src/commands/init.ts` → `buildAdapters`.

## Worked example

`packages/host-claude` is the simpler of the two: one JSON file, one server
entry. `packages/host-codex` shows the harder case, where the configuration
format cannot be edited losslessly and the plan has to say so.
