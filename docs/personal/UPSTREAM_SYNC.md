# Upstream Synchronization Guide

This guide describes the procedure for keeping this personal fork updated with upstream improvements from [pingdotgg/t3code](https://github.com/pingdotgg/t3code) while preserving all personal customizations.

## Fork dependencies to preserve

Preserve the personal provider, usage, workflow and desktop changes described in
[MODIFICATIONS.md](./MODIFICATIONS.md). Zed worker/thread MCP forwarding and effort
controls depend on the separately configured companion bridge; a desktop update
does not bundle that executable. Check the current source and
[verification record](./VERIFICATION.md) after a merge.

## Merge-based synchronization

This fork uses merges rather than rebase. Merges preserve personal commit history and are more resilient to conflicts across many files.

1. **Ensure Working Directory is Clean**:

   ```bash
   git status
   ```

   Commit or stash any uncommitted work before proceeding.

2. **Fetch Upstream**:

   ```bash
   git fetch upstream
   ```

3. **Merge Upstream**:

   ```bash
   git merge upstream/main
   ```

   Resolve any conflicts in your editor.

4. **Stage Only Changed Files** (do not use `git add .` or `git add -A`):

   ```bash
   git add <specific-file-path> [<file-path-2> ...]
   ```

5. **Complete the Merge**:
   ```bash
   git commit -m "chore(personal): merge upstream/main"
   ```

## Common merge conflicts

The most commonly conflicted files are:

- `packages/contracts/src/settings.ts`: Ensure the personal font sizes (20/18/18/17) are retained.
- `apps/server/src/provider/builtInDrivers.ts`: Keep `makeAbacusDriver` registered in the drivers list.
- `apps/web/src/components/sidebar/SidebarChrome.tsx`: Ensure the two-line "personal" header formatting is kept.

## Post-merge verification checklist

After resolving conflicts, diff each changed upstream file against `upstream/main` to catch work that a merge silently undid:

```bash
git diff upstream/main -- <conflicted-file>
```

**Known cases to watch for:**

- `packages/client-runtime/src/state/providerInstanceDisplay.ts`: a sync silently reverted upstream #9899's badge helper signature, module doc and tests.
- `docs/README.md`: merge 69bbd365f dropped upstream's Runbooks section.
- Fork features that upstream tests don't provide (`DelegationGuards`, the recovery worker's `ProviderRegistry`) are read with `Effect.serviceOption`, so upstream test call sites need no edits. Keep new fork dependencies behind the same kind of optional seam.
- The fork's verified official rates outrank the LiteLLM table, so upstream usage tests that set a custom rate for an officially priced model fail. Retarget the test model; don't weaken the official-rate rule.

Run focused checks on changed files:

```bash
vp i                                    # Install dependencies
vp run --filter t3 typecheck            # Server typecheck
vp run --filter @t3tools/web typecheck  # Web typecheck
vp test run <files>                     # Focused tests for changed behavior
```

Do not run `vp check`, `vp run build`, or repository-wide test suites. CI owns the full suite.
