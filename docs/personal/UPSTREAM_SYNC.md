# Upstream Synchronization Guide

This guide details the procedure for keeping this personal fork updated with upstream improvements from [pingdotgg/t3code](https://github.com/pingdotgg/t3code) while preserving all personal customizations.

---

## 1. Remote Setup

Ensure you have both your personal remote and the official upstream remote configured in your git repository:

```bash
# Check current remotes
git remote -v

# If upstream is not yet configured:
git remote add upstream https://github.com/pingdotgg/t3code.git

# Fetch the latest branches and tags from upstream
git fetch upstream
```

---

## 2. Synchronization Strategy: Rebase vs. Merge

Rebasing onto `upstream/main` is recommended because it keeps personal commits cleanly situated on top of the latest upstream trunk.

### Rebasing Workflow

1. **Ensure Working Directory is Clean**:
   Commit any active working changes to your branch:

   ```bash
   git status
   git add .
   git commit -m "feat(personal): update personal modifications"
   ```

2. **Fetch and Rebase**:

   ```bash
   git fetch upstream main
   git rebase upstream/main
   ```

3. **Resolving Conflicts (if any)**:
   The most common files to review during a rebase conflict are:
   - `packages/contracts/src/settings.ts`: Upstream may add new default client settings. Ensure the personal font sizes (20/18/18/17) are retained.
   - `apps/server/src/provider/builtInDrivers.ts`: Upstream may register new providers. Keep `makeAbacusDriver` registered in the drivers list.
   - `apps/web/src/components/sidebar/SidebarChrome.tsx`: Ensure the two-line "personal" header formatting is kept.

4. **Continue the Rebase**:
   ```bash
   git add <resolved-files>
   git rebase --continue
   ```

---

## 3. Post-Sync Verification Checklist

After any upstream rebase or merge, run the following commands in sequence:

### 1. Install Dependencies

Ensure any new upstream packages are installed and lockfiles are resolved:

```bash
pnpm install
```

### 2. Run Abacus Unit Tests

Verify that the autonomous agent loop and safety filters pass without regression:

```bash
pnpm --filter t3 test src/provider/Layers/AbacusAdapter.test.ts
```

### 3. Run Settings & Appearance Tests

Verify that default font sizes and branding tests pass:

```bash
pnpm --filter @t3tools/contracts test src/settings.test.ts
pnpm --filter @t3tools/web test src/branding.test.ts
```

### 4. Monorepo Build

Confirm that the entire project compiles cleanly:

```bash
vp run build
```

### 5. Launch Desktop App

Launch the desktop application to visually inspect the sidebar title and test RouteLLM agent execution:

```bash
vp run dev:desktop
```
