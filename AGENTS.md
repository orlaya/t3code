# AGENTS.md

## Task Completion Requirements

- All of `bun fmt`, `bun lint`, and `bun typecheck` must pass before considering tasks completed.
- NEVER run `bun test`. Always use `bun run test` (runs Vitest).

## Project Snapshot

T3 Code is a minimal web GUI for using coding agents like Codex and Claude.

This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Package Roles

- `apps/server`: Node.js WebSocket server. Wraps Codex app-server (JSON-RPC over stdio), serves the React web app, and manages provider sessions.
- `apps/web`: React/Vite UI. Owns session UX, conversation/event rendering, and client-side state. Connects to the server via WebSocket.
- `packages/contracts`: Shared effect/Schema schemas and TypeScript contracts for provider events, WebSocket protocol, and model/session types. Keep this package schema-only — no runtime logic.
- `packages/shared`: Shared runtime utilities consumed by both server and web. Uses explicit subpath exports (e.g. `@t3tools/shared/git`) — no barrel index.

## Codex App Server (Important)

T3 Code is currently Codex-first. The server starts `codex app-server` (JSON-RPC over stdio) per provider session, then streams structured events to the browser through WebSocket push messages.

How we use it in this codebase:

- Codex provider availability, account/model probing, and app-server initialization params live in `apps/server/src/provider/Layers/CodexProvider.ts`.
- Session startup/resume, turn payload construction, stdout/stderr handling, and JSON-RPC calls to `codex app-server` live in `apps/server/src/provider/Layers/CodexSessionRuntime.ts`.
- The provider adapter boundary and Codex event-to-runtime-event mapping live in `apps/server/src/provider/Layers/CodexAdapter.ts`.
- Provider dispatch, session bindings, and runtime event routing live in `apps/server/src/provider/Layers/ProviderService.ts`.
- WebSocket RPC routing lives in `apps/server/src/ws.ts`.
- Web app consumes orchestration domain events via WebSocket push on channel `orchestration.domainEvent` (provider runtime activity is projected into orchestration events server-side).

Docs:

- Codex App Server docs: https://developers.openai.com/codex/sdk/#app-server

## Reference Repos

- Open-source Codex repo: https://github.com/openai/codex
- Codex-Monitor (Tauri, feature-complete, strong reference implementation): https://github.com/Dimillian/CodexMonitor

Use these as implementation references when designing protocol handling, UX flows, and operational safeguards.

## Known Shadow Checkpoint Issue

On macOS, Git can be killed with exit code 137 while memory-mapping a rebuilt Mach-O `.node` binary. This makes every T3 checkpoint capture fail and leaves zero-byte temporary index lock files in the shadow repository. A project-local `core.bigFileThreshold` setting does not apply because checkpoint commands use the separate bare shadow repository as their `--git-dir`.

The immediate repair for an affected shadow repository is:

```sh
git --git-dir=<t3-base-dir>/checkpoints/<project-hash>/repo.git config core.bigFileThreshold 4m
```

The proper T3 fix belongs in `apps/server/src/vcs/GitVcsDriver.ts`: shadow repository setup should idempotently establish the safe threshold for both existing and newly created repositories. Checkpoint cleanup should also account for `<temporary-index>.lock` when Git dies before removing its own lock. Preserve the separate shadow-repository design described in `tweaks/shadow-checkpoints.md`; do not move checkpoint objects or refs back into project repositories.
