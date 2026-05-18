# Shadow Checkpoints

## Intent

Keep T3 checkpoint Git objects and refs out of user project repositories.

The project repo should not gain `refs/t3/checkpoints/*`, hidden checkpoint commits, or object/history clutter from T3 Code.

## Current Behaviour

Checkpoint capture, diff, restore, and delete use a T3-owned bare shadow repo under the configured T3 base directory:

`<baseDir>/checkpoints/<project-hash>/repo.git`

The project hash is derived from the real Git repository root and common Git directory, so worktrees for the same repository share checkpoint storage.

Old project-side checkpoint refs are intentionally ignored. This fork draws a line from this change onward instead of carrying compatibility code for old checkpoints.

## Key Files

- `apps/server/src/config.ts`
- `apps/server/src/vcs/GitVcsDriver.ts`
- `apps/server/src/checkpointing/Layers/CheckpointStore.test.ts`

## Merge Notes

Upstream may move checkpoint logic between `CheckpointStore`, `VcsDriver`, and `GitVcsDriver`.

When merging, preserve the rule that checkpoint operations must not run `update-ref refs/t3/checkpoints/...` or write checkpoint commits in the user project repo.

Restore is the fussy bit: checkpoint commits live in a different object database, so project-local `git restore --source <checkpoint>` does not work for shadow checkpoints. Restore must read from the shadow repo and apply the tree back to the project working tree while preserving current cleanup semantics for removed files.
