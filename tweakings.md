# TWEAKINGS

**Shrink-to-narrow window support:**

- `apps/desktop/src/main.ts:1930-1931` — Electron `minWidth: 430, minHeight: 400` (was 840/620, then 400/400).
- `apps/web/src/components/AppSidebarLayout.tsx:9` — `THREAD_MAIN_CONTENT_MIN_WIDTH` set to `25*16`. Note: this constant only governs sidebar-drag behaviour, not any CSS min-width.

**Sidebar mobile breakpoint lowered (768px → 600px):**

- `apps/web/src/hooks/useMediaQuery.ts` — `useIsMobile()` changed from `useMediaQuery("max-md")` (768px) to `useMediaQuery({ max: 600 })`. Sidebar stays persistent/dockable down to 600px; below that it becomes the collapsible sheet/drawer.
- `apps/web/src/components/ui/sidebar.tsx` — all six `md:` prefixed CSS classes replaced with `min-[600px]:` arbitrary breakpoints to stay in sync with the JS change: wrapper visibility (`md:block`), container flex (`md:flex`), inset variant styling (`md:peer-data-*`), two mobile hit area expansions (`md:after:hidden`), and hover-reveal opacity (`md:opacity-0`). Traffic-light clearance unaffected — `pl-[90px]` triggers on `state === "collapsed"` independently of `isMobile`.

**Desktop sidebar toggle:**

- Removed `md:hidden` from every `SidebarTrigger` usage so it's visible on desktop (`ChatHeader.tsx:74`, `NoActiveThreadState.tsx:20`, `settings.tsx:37`). Also removed the redundant one from `Sidebar.tsx:1964` (was next to T3 Code wordmark) + its unused import.
- `SidebarTrigger` in `ui/sidebar.tsx` simplified to always render `PanelLeftIcon` (removed the `openMobile`-conditional swap with `PanelLeftCloseIcon`).

**macOS traffic-light clearance:**

- `NoActiveThreadState.tsx` and `ChatView.tsx` now conditionally add `pl-[90px]` when sidebar is collapsed OR in mobile mode (via `useSidebar()` → `state === "collapsed" || isMobile`). Base horizontal padding was split from `px-3 sm:px-5` into `pl-3 pr-3 sm:pl-5 sm:pr-5` to avoid Tailwind v4 class-order conflicts with the arbitrary `pl-[90px]`.

**Header button cleanup:**

- The standalone "Add action" button (else branch when no scripts exist) in `ProjectScriptsControl.tsx:342-355` now hides entirely below 500px viewport (`max-[499px]:hidden`). Above that it's icon-only until `@3xl/header-actions`, then gains the "Add action" text label. Dropdown "Add action" menu item when scripts DO exist is unchanged.
- Removed `GitActionsControl` entirely from `ChatHeader.tsx` + cleaned up now-unused imports and props (`activeThreadEnvironmentId`, `activeThreadId`, `draftId`, `gitCwd`, `scopeThreadRef`, `GitActionsControl` import) and the corresponding props passed from `ChatView.tsx`. The component file + tests still exist as dead code.

**Sidebar sheet animation:**

- `ui/sidebar.tsx:230` — `SheetPopup` className includes `duration-0` (was originally 200ms transition). Mobile sidebar opens instantly.

**Keybinding for sidebar toggle:**

- `packages/contracts/src/keybindings.ts` — added `"sidebar.toggle"` to `STATIC_KEYBINDING_COMMANDS`.
- `apps/server/src/keybindings.ts` — added default `{ key: "mod+b", command: "sidebar.toggle", when: "!terminalFocus" }`.
- `apps/web/src/routes/_chat.tsx` — imports `useSidebar`, handles `"sidebar.toggle"` command by calling `toggleSidebar()`, added `toggleSidebar` to useEffect deps.
- Contracts + server changes require dev-server restart, not just HMR.

**Command palette / mobile sidebar fixes:**

- `Sidebar.tsx` — replaced `CommandDialogTrigger` (imported from `./ui/command`) with plain `SidebarMenuButton`. Its onClick now: `if (isMobile) setOpenMobile(false); openCommandPalette(true);`. This sidesteps a base-ui nested-dialog bug where clicking search inside the mobile sheet was closing the sheet without opening the palette. Added `useSidebar` to the import from `./ui/sidebar`, removed unused `CommandDialogTrigger` import.
- `ui/sidebar.tsx` — `SheetPopup` now has `initialFocus={() => document.querySelector('[data-testid="command-palette-trigger"]')}` so opening the sidebar via Cmd+B focuses the Search button (instead of auto-focusing the T3 wordmark Link, which was showing its version tooltip).

**Command palette positioning on mobile:**

- `ui/command.tsx:46` — `CommandDialogViewport` padding changed from `py-[max(--spacing(4),4vh)] sm:py-[10vh]` to unified `py-[max(--spacing(4),10vh)]`. Mobile now matches desktop positioning.

**Composer footer narrow-screen redesign:**

- `ChatComposer.tsx` — removed the `<620px` compact branch that collapsed Mode/Access/Effort into a "…" overflow menu. `ComposerFooterModeControls` (and provider traits picker) now render inline at every width. `CompactComposerControlsMenu` import, `providerTraitsMenuContent` assignment, and `renderProviderTraitsMenuContent` import are commented out with a "preserved for possible restore" note — component file left intact.
- `ProviderModelPicker.tsx` — `compact` now drops the model name text entirely; only provider icon + chevron remain. Old `max-w-42` / `max-w-36` caps removed in the compact branch so the trigger sizes to content.
- Separators (`|` pipes) in `ComposerFooterModeControls` changed from `hidden sm:block` → always visible (`mx-0.5 h-4`).
- Text labels flipped: text is now always visible, icons drop below 640px (`hidden sm:inline` on `BotIcon`, `RuntimeModeIcon`, `ListTodoIcon`). Old `sr-only sm:not-sr-only` on text spans removed. `BotIcon` doesn't change between Plan/Build so icon-only gave no state feedback.
- Runtime mode "Auto-accept edits" → **"Accept edits"**. Updated `runtimeModeConfig` in `ChatComposer.tsx:119`, the menu item in `CompactComposerControlsMenu.tsx:68` (still dead code but kept consistent), and the test `ChatView.browser.tsx:3266`.
- `index.css` — added a scoped rule: `[data-chat-composer-footer="true"] button, [data-chat-composer-footer="true"] [role="combobox"] { font-size: var(--text-sm); ... }`. Button's base class has `text-base ... sm:text-sm`, which made composer text counterintuitively larger on mobile than desktop. This rule forces `text-sm` at all widths inside the footer only.
- `index.css` — below 470px, chevrons disappear from the composer footer dropdowns to free horizontal space. `max-[469px]:hidden` added inline to `ProviderModelPicker.tsx` chevron and both `TraitsPicker.tsx` chevrons. The shared `SelectTrigger` chevron (used by the runtime-mode dropdown) is scoped via CSS: `@media (max-width: 469px) { [data-chat-composer-footer="true"] [data-slot="select-icon"] { display: none; } }`.

**User message restyle (MessagesTimeline.tsx):**

- Copy/revert buttons and timestamp moved outside the bordered box, onto their own right-aligned row below it — matches how the assistant's meta row sits below its content. `group` class moved to the outer wrapper so hover on box OR meta row reveals the buttons.
- Timestamp restyled to match the assistant: `text-[11px] text-muted-foreground/70` (was `text-xs text-muted-foreground/50`).

**Timestamp format unification (`timestampFormat.ts`):**

- Dropped seconds from `formatTimestamp` — now hour + minute only (was `second: "2-digit"` too).
- Deleted `formatShortTimestamp` since it was now identical. Updated sole caller `DiffPanel.tsx:514` to use `formatTimestamp`.
- Removed the `includeSeconds` parameter from `getTimestampFormatOptions` and `getTimestampFormatter`. Cache key simplified. Test file `timestampFormat.test.ts` updated to match.

**Unified message action buttons:**

- Both user message (copy + revert) and assistant message (copy) action buttons now use `size="icon-xs"` + `variant="ghost"` + `text-muted-foreground/70 hover:text-foreground`. Previously the user's were bordered `size="xs" variant="outline"` and the assistant's had a custom bordered/translucent style — unified to a mid-contrast ghost icon. `MessageCopyButton` call sites at ~355 and ~434.

**ChatHeader icon buttons — unified height + icon sizing:**

- All four icon-shaped header buttons (SidebarTrigger, Terminal Toggle, Diff Toggle, and the Zed-picker primary + chevron in `OpenInPicker.tsx`) are pinned to 24px at every width — Button/Toggle `xs`/`icon-xs` sizes default to `h-7 sm:h-6`, which jumps to 28px below the 640px `sm` breakpoint. Each call site now adds `h-6` / `size-6` to kill the breakpoint bump.
- `SidebarTrigger` at `ChatHeader.tsx:61` passes `variant="outline" size="icon-xs" className="size-6 shrink-0 [&_svg]:!size-3 [&_svg]:!opacity-64"`. The `!` on the svg overrides are needed because Button's `icon-xs` variant has a higher-specificity `[&_svg:not([class*='size-'])]:size-3.5` rule and its own opacity-80 rule; `!important` beats both. Works because `SidebarTrigger` spreads `...props` after its `size="icon" variant="ghost"` defaults, so caller props win.
- Terminal + Diff `<Toggle>` both get `h-6 min-w-6 shrink-0` inline.
- `OpenInPicker.tsx` — primary button gets `h-6`, icon shrunk `size-3.5` → `size-3`. Chevron button gets `size-6` and is hidden below `@3xl/header-actions` (via `hidden @3xl/header-actions:inline-flex` on the rendered Button). Because the Group's border-stripping rules (`*:data-slot:has-[~[data-slot]]:rounded-e-none` etc) still match when the chevron is just visually hidden (it's still in the DOM), the primary button also gets `@max-3xl/header-actions:rounded-e-md! @max-3xl/header-actions:border-e! @max-3xl/header-actions:before:rounded-e-[calc(var(--radius-md)-1px)]!` to restore its right edge below the breakpoint.
- `ProjectScriptsControl.tsx` standalone "Add action" button: `className="h-6 max-[499px]:hidden [&_svg]:!size-3"` — same 24px pin plus forced 12px icon via `!` (its PlusIcon has an explicit `size-3.5` class that needs overriding).

**Theme colors:**

- `index.css:99,110,128,139` — `--primary` and `--ring` changed from `oklch(0.488 0.217 264)` blue to `#F5B162` orange. Applied to both light and dark roots.
- `index.css:107,136` — `--destructive` changed from `var(--color-red-500)` / `color-mix(...)` dark to `#eb889f` (muted pink-red). Applied to both themes.
- `ComposerPrimaryActions.tsx:113` — stop/interrupt button switched from hardcoded `bg-rose-500/90 hover:bg-rose-500` to `bg-destructive/90 hover:bg-destructive` (semantic token). Tweaking `--destructive` in `index.css` now moves the stop button too.
- `--primary-foreground` kept as white and `--destructive-foreground` kept as `red-700`/`red-400`. Potential follow-ups if contrast reads poorly on the new base colors.

**Badge outline variant breathing room + No Git removal:**

- `ChatHeader.tsx` — project-name badge gets `h-6 min-w-0 shrink overflow-hidden px-2 opacity-80 sm:h-5 sm:px-1.5` inline. Extra horizontal > vertical breathing room, plus `opacity-80` to mute the badge (text + border + bg all dim together). Applied only at this call site; the global outline variant in `ui/badge.tsx` was reverted so other outline badges (e.g. command-menu "model" badge) keep the default tighter dimensions and full opacity.
- `ChatHeader.tsx:77-81` — "No Git" badge commented out (not deleted). `isGitRepo` prop is still used to disable the Diff toggle.

**Thinking blocks surfaced in the timeline (NEW feature, not a tweak — see `__notes/PLAN.thinking.md` for the full plan + handoff):**

- Contracts: `AgentKind` (literal `"primary" | "sub"`) added to `packages/contracts/src/baseSchemas.ts`. `providerRuntime.ts` re-imports it from baseSchemas (was previously defined there — moved to break a circular dep with `orchestration.ts`). `ProviderRuntimeEventBase.agentKind` is now a **required** field — every fixture/test that fabricates a runtime event needs it.
- Contracts: `OrchestrationMessageRole` extended with `"thinking"`. `OrchestrationMessage` and `ThreadMessageSentPayload` gained optional `agentKind`. `ThreadMessageAssistantDeltaCommand` and `ThreadMessageAssistantCompleteCommand` gained optional `role` + `agentKind` so they can carry thinking messages without parallel command types.
- Claude adapter: full thinking-block tracking — `ThinkingBlockState` interface, `thinkingBlocks: Map<number, ThinkingBlockState>` on `ClaudeTurnState`, registration on `content_block_start` (`block.type === "thinking"`), itemId attachment on `content_block_delta` thinking_delta, `completeThinkingBlock` helper called from `content_block_stop`. `agentKind` stamped on every emitted event via `resolveAgentKind(context)` which compares `resumeSessionId` to `primarySessionId`. `handleSdkMessage` ordering: `ensureThreadId` runs before `logNativeSdkMessage` (was reversed; would have lagged the native log by one message in agentKind).
- Codex adapter: wrapped `codexEventBase` / `resolveAgentKind` / `runtimeEventBase` / `mapItemLifecycle` / `mapToRuntimeEvents` in a `createCodexEventMapper(subAgentTaskIds: Set<string>)` factory. `task_started` adds the taskId, `task_complete` deletes after building events (so `task.completed` itself is still classified `"sub"`).
- OpenCode adapter (upstream `#1758`): `buildEventBase` helper hard-codes `agentKind: "primary"` and includes it in its `Pick<ProviderRuntimeEvent, ...>` return type. No sub-agent concept in OpenCode currently, so no per-event resolver needed. If OpenCode ever gains sub-agent semantics upstream, flip this to a resolver matching the Claude/Codex pattern.
- Decider: `thread.message.assistant.delta` and `.complete` cases now emit `role: command.role ?? "assistant"` and pass through `agentKind` when set.
- Projector: `thread.message-sent` case copies `agentKind` from payload onto the in-memory `OrchestrationMessage`.
- Persistence: `ProjectionPipeline.ts` `thread.message-sent` case early-returns when `event.payload.role === "thinking"`. Thinking is in-memory only, never hits the DB.
- Ingestion: parallel `reasoningDelta` extraction next to `assistantDelta`; dispatches `thread.message.assistant.delta` with `role: "thinking"` + `agentKind`, message id `thinking:${event.itemId ?? event.eventId}`. Doesn't go through the buffered streaming branch (always streaming). `item.completed` with `itemType: "reasoning"` triggers the matching `.complete` dispatch.
- Web `types.ts` — `ChatMessage.role` extended with `"thinking"`, optional `agentKind` field added.
- Web `store.ts` — message mapper passes `agentKind` through when present.
- Web `session-logic.ts` — `deriveTimelineEntries` accepts optional `latestTurnId`; thinking messages filtered out unless `message.turnId === latestTurnId`. Mirrors the work-log "latest turn only" pattern.
- Web `MessagesTimeline.logic.ts` — new `kind: "thinking"` row in `MessagesTimelineRow`, emitted from `deriveMessagesTimelineRows` when `message.role === "thinking"`. `TimelineDurationMessage.role` extended.
- Web `MessagesTimeline.tsx` — new `ThinkingSection` component. Primary variant: rounded card with "Thinking" header + streaming dots, muted italic markdown via `ChatMarkdown`, show-more/less when text > 240 chars, `max-h-28` collapsed scrollable container that auto-scrolls to bottom on text update via ref + `useEffect`, gradient at the top edge to fade older content. Sub-agent variant: one-line stub with truncated preview.
- Web `index.css` — added `.thinking-collapsed-scroll` utility (hides scrollbar in the collapsed thinking container while keeping scroll behaviour).
- **Operational gotcha:** dev server does NOT pick up adapter changes via HMR. Restart required. Spent ~30 min on what looked like a code bug (0/345 reasoning_text events without itemId) before realising the runtime was stale.
- **Open bug:** substantial flicker on the first message of a conversation. Investigation deferred — see PLAN.thinking.md for hypotheses + diagnostic plan.

**Session reconciliation (dead session + stuck permission prompt fixes):**

- `apps/server/src/provider/Services/ProviderSessionReaper.ts` — added `reconcile()` method to the service interface.
- `apps/server/src/provider/Layers/ProviderSessionReaper.ts` — added reconcile logic that compares orchestration read model against live provider sessions (`providerService.listSessions()`), marks orphaned sessions as `"stopped"` via `thread.session.set` dispatch. Runs on the existing 5-min reaper schedule AND exposed for on-demand calls. Handles the case where a provider process dies silently (laptop sleep, OOM) without emitting `session.exited`.
- `apps/server/src/ws.ts` — wired `ProviderSessionReaper` into the WS layer; `subscribeShell` calls `reconcile()` before delivering the snapshot so clients see corrected state immediately on reconnect.
- `apps/server/src/server.test.ts` — added mock `ProviderSessionReaper` to test layer.
- `apps/web/src/session-logic.ts` — `derivePendingApprovals()` and `derivePendingUserInputs()` now accept optional `sessionPhase` param, return empty when `"disconnected"`. Fixes stuck permission/user-input prompts when session dies mid-approval.
- `apps/web/src/components/ChatView.tsx` — updated both `derivePendingApprovals` and `derivePendingUserInputs` call sites to pass `phase`.

**Preserve provider bindings when stopping sessions (manual port of upstream `721b6b4c`):**

- `apps/server/src/provider/Layers/ProviderService.ts` — `stopSession()` now calls `directory.upsert({ status: "stopped" })` instead of `directory.remove()`, preserving the binding row and `resumeCursor` in SQLite so sessions can resume with full conversation history.
- `apps/server/src/provider/Services/ProviderSessionDirectory.ts` — removed `remove()` from the service interface.
- `apps/server/src/provider/Layers/ProviderSessionDirectory.ts` — removed `remove()` implementation.
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts` — removed `providerChanged` logic that was clearing `resumeCursor` on provider switch (provider switching is rejected anyway). Simplifies the session restart path.
- Test files updated to match: `ProviderCommandReactor.test.ts`, `ProviderService.test.ts`, `ProviderSessionDirectory.test.ts`, `CodexAdapter.test.ts`.

**Vitest env var leak fix:**

- `apps/web/vitest.config.ts` — new file. Overrides the `define` block from `vite.config.ts` to force `VITE_HTTP_URL` and `VITE_WS_URL` to empty strings during test runs. Fixes 6 tests in `authBootstrap.test.ts` and `bootstrap.test.ts` that were failing when the dev server was running (Vite's `define` baked real env vars as literal string replacements, making `vi.stubEnv` / `vi.stubGlobal` mocks ineffective).
- `apps/web/src/rpc/wsTransport.test.ts` — added missing `href` property to the mock `window.location` object. `resolvePrimaryEnvironmentHttpUrl` calls `new URL(window.location.href)` which needs `href` to exist.

**User-initiated interrupt misclassified as runtime error:**

- `apps/server/src/provider/Layers/ClaudeAdapter.ts` — `isInterruptedResult()` now checks the SDK's `terminal_reason` field first. When `terminal_reason` is `"aborted_streaming"` or `"aborted_tools"`, the result is classified as `"interrupted"` immediately — no string matching needed. Previously the function relied on pattern-matching error text (`"aborted"`, `"interrupt"`, etc.) and checking `is_error === false`, but the SDK sends `is_error: true` for user-initiated interrupts and stuffs diagnostic metadata (`[ede_diagnostic] result_type=user ...`) into the `errors` array instead of recognisable abort text. The old string patterns never matched, so every user interrupt fell through to `"failed"` status → `emitRuntimeError()` → error banner + red "Runtime error" in the work log. The `is_error === false` and string-matching fallbacks are preserved for older SDK versions that may not include `terminal_reason`.

**Opus 4.7 empty thinking blocks:**

- `apps/server/src/provider/Layers/ClaudeAdapter.ts` — when `apiModelId` starts with `claude-opus-4-7`, `queryOptions` now includes `thinking: { type: "adaptive", display: "summarized" }`. Reason: Anthropic changed Opus 4.7's default for `thinking.display` from `"summarized"` (Opus 4.6 and earlier Claude 4 behaviour) to `"omitted"`. With `display: "omitted"`, the stream produces `content_block_start` (type `thinking`) → a single `signature_delta` (encrypted thinking signature) → `content_block_stop`, and **zero `thinking_delta` events**. Result: the fork's thinking UI rendered an empty box for every Opus 4.7 turn. Confirmed via a temporary diagnostic log of raw stream events — only signature deltas arrived. Opus 4.7 also rejects `thinking: { type: "enabled" }` with a 400, so adaptive is the only valid mode. Gated on `startsWith("claude-opus-4-7")` so the `[1m]` context-window variant also matches. Opus 4.6 / Sonnet 4.6 / Haiku 4.5 left untouched — they still work on their legacy defaults. A diagnostic `Effect.logInfo("claude.opus47.stream_event", ...)` is temporarily in `handleStreamEvent` to verify `thinking_delta` events resume; remove once confirmed.

**Disabled expensive Claude model options (fast mode + 1M context):**

- `apps/server/src/provider/Layers/ClaudeProvider.ts` — Opus 4.6 `supportsFastMode` flipped from `true` to `false`. Fast mode on Opus is prohibitively expensive; disabling it at the capabilities level means the toggle never appears in the TraitsPicker UI.
- `apps/server/src/provider/Layers/ClaudeProvider.ts` — removed `{ value: "1m", label: "1M" }` from `contextWindowOptions` on all three Claude models (Opus 4.7, Opus 4.6, Sonnet 4.6). Each now only offers `200k` (the default). 1M context is too costly for regular use; removing it from capabilities means the context window selector doesn't render at all (single option = nothing to pick).

**Assistant streaming: timed flush (replaces per-token dispatch):**

- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts` — when `enableAssistantStreaming` is `true`, assistant text deltas now accumulate in the existing buffer and flush every 150ms instead of dispatching every individual token. A `lastAssistantFlushTimestampByMessageId` map tracks when each message last flushed; on each incoming delta, if ≥150ms has elapsed the buffer is drained into a single dispatch. First delta for a new message dispatches immediately (no prior timestamp). The 24K char safety-valve spill is preserved. `clearAssistantMessageState` now also cleans up the timestamp entry. Completion and interruption still flush any remainder via the existing `finalizeAssistantMessage` path (called on both `item.completed` and `turn.completed`). Added `STREAMING_FLUSH_INTERVAL_MS = 150` constant. Provider-agnostic — applies to Claude, Codex, and OpenCode equally since the change sits in the shared ingestion layer.
- `packages/contracts/src/settings.ts` — `enableAssistantStreaming` default flipped from `false` to `true`. Streaming is now on out of the box.

**Context window meter — accurate context fill tracking:**

- The composer's context window meter (circular progress indicator next to the send button) was showing wildly inflated numbers (e.g. 927k) because it was using the Claude Agent SDK's `total_tokens` from `task_progress` events — an accumulated total across ALL API calls in the session, not the current context window fill level.
- `apps/server/src/provider/Layers/ClaudeContextWindowTracker.ts` — new dependency-free module. Captures per-API-call token usage from raw `message_delta` stream events (which the Anthropic API emits at the end of each response with a per-request `usage` object). Context fill = `input_tokens + cache_creation_input_tokens + cache_read_input_tokens + output_tokens` from the last API call. Exposes `recordMessageDeltaUsage()`, `setContextWindow()`, and `snapshot()`. Intentionally isolated from Effect/SDK imports to minimise merge-conflict surface with upstream.
- `apps/server/src/provider/Layers/ClaudeAdapter.ts` — added `contextWindowTracker: ClaudeContextWindowTracker` to `ClaudeSessionContext`, initialised via `createClaudeContextWindowTracker()`. `handleStreamEvent` captures `message_delta` usage for primary agent only (`resolveAgentKind(context) === "primary"`). `completeTurn`, `task_progress`, and `task_notification` cases all prefer the tracker's snapshot over the old `normalizeClaudeTokenUsage` accumulated-based logic, falling back only when the tracker has no data yet (e.g. session just started, no `message_delta` received).
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts` — `thread.token-usage.updated` case now early-returns `[]` when `event.agentKind === "sub"`, preventing sub-agent token counts from overwriting the primary agent's context window display.

**Work log icon cleanup + tool call labels (MessagesTimeline.tsx, ClaudeAdapter.ts):**

- `apps/web/src/components/chat/MessagesTimeline.tsx` — consolidated work log icons. Replaced `BotIcon` (thinking tone), `SquarePenIcon` (file changes), and `HammerIcon` (dynamic/collab tool calls) with `SearchIcon` (magnifying glass) from lucide-react. Removed unused `BotIcon`, `HammerIcon`, `SquarePenIcon` imports. Sub-agent entries (tone `"thinking"`, i.e. `task.progress` activities) use `CircleDashedIcon` (dashed circle) to visually distinguish them from primary agent tool calls. Kept `TerminalIcon` (commands), `EyeIcon` (file reads / image views), `GlobeIcon` (web search), `WrenchIcon` (MCP), `CircleAlertIcon` (errors), `CheckIcon` (info), `ZapIcon` (generic fallback).
- `apps/server/src/provider/Layers/ClaudeAdapter.ts` — `titleForTool` now accepts optional `toolName` and delegates to new `friendlyToolTitle()` for known tools: Read, Edit, Write, Grep, Glob, Bash, NotebookEdit. Falls back to the `itemType`-based labels ("Command run", "Subagent task", etc.) for unrecognised names. Call site updated to pass `toolName`.
- `apps/server/src/provider/Layers/ClaudeAdapter.ts` — `summarizeToolRequest` rewritten to extract human-readable details instead of JSON-dumping tool inputs. File-path tools (Read, Edit, Write) show just the path. Pattern tools (Grep, Glob) show just the pattern. Command tools show just the command text (dropped redundant `toolName:` prefix). Agent tools unchanged. JSON fallback still exists for unknown tool shapes but also drops the `toolName:` prefix (title already carries the name).

**Dev runner: force no-browser in desktop mode:**

- `scripts/dev-runner.ts:169` — in the desktop-mode branch, explicitly sets `output.T3CODE_NO_BROWSER = "1"` (replacing upstream's `delete output.T3CODE_NO_BROWSER;`). Was auto-opening a browser during `bun dev:desktop` sessions, which is annoying and wasteful when the Electron window is the intended surface. The old `delete` left the var undefined so the downstream dev server defaulted to opening a browser; setting it to `"1"` explicitly suppresses it.
- `scripts/dev-runner.test.ts:195` — `T3CODE_NO_BROWSER` assertion updated from `undefined` to `"1"` to match the new behaviour.

**Cursor/ACP adapter — agentKind plumbing (parallel to OpenCode tweak):**

- `apps/server/src/provider/Layers/CursorAdapter.ts:305` — `makeEventStamp()` helper now returns `{ eventId, createdAt, agentKind: "primary" as const }`. Cursor has no sub-agent concept currently, so hard-coded. Every event emission in the adapter flows through this helper (either spread as `...(yield* makeEventStamp())` or passed as `stamp:` into the `makeAcp*Event` helpers), so the one change cascades to ~14 event constructions without per-site edits.
- `apps/server/src/provider/acp/AcpCoreRuntimeEvents.ts` — `AcpEventStamp` interface extended with `readonly agentKind: AgentKind`, added `AgentKind` to the `@t3tools/contracts` import. The existing `...input.stamp` spreads inside the `makeAcp*Event` functions pick up `agentKind` automatically.
- `apps/server/src/provider/acp/AcpCoreRuntimeEvents.test.ts:15` — test stamp literal updated to include `agentKind: "primary" as const`. If Cursor or a future ACP-over-JSON-RPC provider ever gains sub-agent semantics upstream, replace the hard-coded stamp agentKind with a per-event resolver matching the Claude/Codex pattern.

**Work log visual overhaul (MessagesTimeline.tsx):**

- Border radius: `rounded-xl` → `rounded-lg` on both `WorkGroupSection` and `ThinkingSection` containers.
- Container padding now conditional on `showHeader`: standalone entries (no header) get `px-0.5 py-0.5` for a tight fit; grouped work log (with header) gets `px-2 py-1.5` to give the "WORK LOG" label breathing room. Uses `cn()` ternary.
- Entry spacing inside work log tightened: `space-y-0.5` → `space-y-0 [&>*]:py-0.25` on the entries wrapper div. The `[&>*]` selector overrides each child's vertical padding only when inside the work log; standalone entries keep their normal `py-1`.
- Individual entry horizontal padding shrunk: `px-1` → `px-0.25`, icon-to-text gap `gap-2` → `gap-1`.
- "Show more" button text simplified: was `Show ${hiddenCount} more`, now just `Show more`. `hiddenCount` variable commented out.

**Work log text brightness bump:**

- `workToneClass()` — all non-error tones bumped to `text-muted-foreground/90` (tool was `/80`, thinking was `/50`, info was `/40`).
- `workToneIcon()` — all icon opacities lowered from `text-foreground/92` to `text-foreground/60` (icons dimmer, text brighter = better hierarchy).
- Thinking icon changed from `CircleDashedIcon` to `SearchIcon` (matches sub-agent entries).
- Preview text in both tooltip and non-tooltip branches: `text-muted-foreground/55` → `text-muted-foreground/80`, and the conditional tone override `/70` → `/80`.
- Changed files overflow count text: `/55` → `/80`.
- Sub-agent thinking row: both label and text bumped from `/50`–`/55` to `/80`.

**Clickable file paths — open in IDE (MessagesTimeline.tsx):**

- New imports: `ExternalLinkIcon` (lucide-react, replaces now-unused `CircleDashedIcon`), `readLocalApi` (~/localApi), `openInPreferredEditor` (../../editorPreferences).
- New helper `workEntryPrimaryFilePath()`: returns the first absolute file path from a work entry. Checks `changedFiles[0]` first (known file paths from tool payloads), then falls back to `detail` but only when it starts with `/` — avoids false positives on bash commands or descriptions.
- `SimpleWorkEntryRow` gains a third rendering branch (between the `rawCommand` tooltip branch and the plain tooltip branch): when `primaryFilePath` exists, renders without any tooltip, adds `group/file cursor-pointer` to the outer div, and wires `onClick` → `openInPreferredEditor(api, primaryFilePath)` via `useCallback`.
- Hover effects on the file-path branch: the file path portion (not the heading or dash) gets `group-hover/file:underline group-hover/file:text-foreground/70`. An `ExternalLinkIcon` (size-3) sits inline after the text, `opacity-0` normally, `group-hover/file:opacity-70` on hover with `transition-opacity`. The `/file` group namespace prevents clashes with other group-hover scopes in the tree.

**Inline edit diffs in the timeline (NEW feature):**

- `apps/web/package.json` — added `diff` (^8.0.3) as an explicit dependency (already in the tree transitively via `@pierre/diffs`).
- `apps/web/src/session-logic.ts` — new `EditDiffEntry` interface and `deriveEditDiffEntries()` function. Filters `tool.completed` activities with `old_string`/`new_string`/`file_path` in the payload. NO turn filtering — edit diffs persist across all turns (unlike work log entries which only show for the latest turn). Edit entry IDs prefixed with `edit:` to avoid key collisions with work log entries that derive from the same underlying activity. Extended `TimelineEntry` union with `kind: "edit"`. Extended `deriveTimelineEntries()` signature with `editEntries` parameter.
- `apps/web/src/components/ChatView.tsx` — added `editDiffEntries` memo derived from `threadActivities`, passed through to `deriveTimelineEntries()`.
- `apps/web/src/components/chat/MessagesTimeline.logic.ts` — added `kind: "edit"` to `MessagesTimelineRow` union with `editEntry: EditDiffEntry`. Handled in `deriveMessagesTimelineRows()` (each edit is its own row, no grouping) and `isRowUnchanged()` stability comparison.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — one import + one JSX line to render `<InlineEditDiff>` for edit rows, passing `workspaceRoot` and `resolvedTheme` from `TimelineRowCtx`.
- `apps/web/src/components/chat/InlineEditDiff.tsx` — **new file**. Standalone component rendering inline edit diffs. Uses `diff.createPatch()` to generate a unified diff string from `old_string`/`new_string`, feeds it to `@pierre/diffs` `parsePatchFiles()` + `FileDiff` for rendering with Shiki syntax highlighting and line wrapping. `disableFileHeader: true` hides the built-in pierre header (our own file path header replaces it). Font size overridden to 11px/15px via `style` prop with CSS custom properties (`--diffs-font-size`, `--diffs-line-height`). `disableLineNumbers: true` hides gutter line numbers (they were always wrong — relative to the snippet, not the file). `hunkSeparators: "simple"` for a subtle bar between hunks. Old/new strings are newline-terminated before `createPatch()` to suppress the "No newline at end of file" marker. Whole block is clickable to open the file in the preferred IDE via `openInPreferredEditor()`. File path header uses `formatWorkspaceRelativePath()`.
- `apps/web/src/session-logic.ts` — `deriveEditDiffEntries()` extended to also capture Write tool activities (`data.toolName === "Write"` with `input.content`). For Writes, `oldString` is set to `""` and `newString` to `input.content`, producing an all-added diff. Edit tool matching unchanged.
- `apps/web/src/session-logic.test.ts` — updated both `deriveTimelineEntries` call sites with the new `editEntries` parameter (empty array).
- Key bug fix: edit entry IDs initially used raw `activity.id`, causing duplicate keys in LegendList (same activity produces both a work log entry and an edit diff entry). Prefixing with `edit:` resolved phantom gaps and duplicate `data-index` values in the virtualised timeline.

**Git diff panel hunk separators:**

- `apps/web/src/components/DiffPanel.tsx` — added `hunkSeparators: "simple"` to `FileDiff` options. Replaces the "N unmodified lines" expandable block with a subtle bar separator.

**Monospace font — Source Code Pro:**

- `apps/web/src/index.css` `@theme inline` — added `--font-mono: "Source Code Pro", "SF Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace`. Tailwind's `font-mono` utility now uses this stack everywhere.
- `apps/web/src/index.css` `:root` — added `--diffs-font-family: var(--font-mono)`. Pierre's shadow DOM inherits this globally — applies to both `DiffPanel` and `InlineEditDiff` without per-component style props.
- `apps/web/src/index.css` `pre, code` rule — simplified from a hardcoded font stack to `var(--font-mono)`.

**Changed files section — agent-only filtering + visual tweaks:**

- `apps/web/src/components/ChatView.tsx` — new `agentEditedFilesByTurnId` memo builds a `Map<TurnId, Set<string>>` from `editDiffEntries`, collecting the file paths the agent actually touched via Edit/Write tool calls per turn. Passed as a prop to `MessagesTimeline`.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — `agentEditedFilesByTurnId` threaded through `MessagesTimelineProps`, `TimelineRowSharedState`, and `TimelineRowCtx` to `AssistantChangedFilesSection`. The outer guard component now filters `turnSummary.files` to only files present in the agent's set (using `endsWith("/" + path)` matching since git diff paths are repo-relative while tool call paths are absolute). If no agent-edited files remain, the entire block returns `null`. Fixes the problem where user edits, or changes from other sessions, would show up in a turn's "Changed files" when not using worktrees.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — `allDirectoriesExpanded` default flipped from `true` to `false`. Changed files tree now starts collapsed.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — "Collapse all" and "View diff" buttons now include `className="text-muted-foreground"` to match the muted shade of the header icon buttons.
- `apps/web/src/components/chat/DiffStatLabel.tsx` — additions colour changed from `text-success` to inline `style={{ color: "#cae28f" }}` (NZ muted green). Deletions changed from `text-destructive` to `style={{ color: "#d36c6c" }}` (NZ muted red).
- `apps/web/src/components/chat/ChangedFilesTree.tsx` — removed `VscodeEntryIcon` from file entries (and its import). File rows now show no icon, just the filename.
- Test files (`MessagesTimeline.browser.tsx`, `MessagesTimeline.test.tsx`) — added `agentEditedFilesByTurnId: new Map()` to test prop builders.

**Project-scoped persistent terminals (terminal-only threads):**

- New concept: "terminal threads" — phantom threads that exist solely to host a project-scoped persistent terminal with no chat UI. The thread ID is prefixed with `TERMINAL-` (ThreadId is just a branded non-empty string, no UUID validation), and the title is fully user-editable (defaults to "Terminal"). Detection is via `isTerminalThread(threadId)` checking the ID prefix.
- `apps/web/src/lib/terminalThread.ts` — new file. Exports `TERMINAL_THREAD_ID_PREFIX`, `DEFAULT_TERMINAL_THREAD_TITLE`, `isTerminalThread()`, `newTerminalThreadId()`.
- `apps/web/src/components/Sidebar.tsx` — new "New terminal" button (TerminalIcon) added to the left of the existing "New thread" button on each project header. Both buttons now sit inside a shared flex container with `gap-0.5`. Handler `handleCreateTerminalClick` dispatches `thread.create` directly via `readEnvironmentApi()` (no draft stage — terminal threads skip the draft→first-message→server-thread flow), waits for the thread to appear in the store via a subscription with a 2s timeout fallback, then navigates. `SidebarThreadRow` detects terminal threads by ID and renders a `TerminalIcon` on the left instead of the PR badge / status pill.
- `apps/web/src/components/ChatView.tsx` — three changes gated on `isTerminalThread(activeThread.id)`: (1) header, error banners, chat column (MessagesTimeline, ChatComposer, BranchToolbar, PlanSidebar) all wrapped in `{!isTerminalOnly && ...}` so they don't render; (2) `reconcileMountedTerminalThreadIds` treats terminal threads as always having their terminal open so the drawer always mounts; (3) `PersistentThreadTerminalDrawer` bypasses the `terminalOpen` store check for terminal threads and uses `flex min-h-0 flex-1 flex-col [&>.thread-terminal-drawer]:!h-full` on the wrapper to override the drawer's inline px height and fill the view. The `hidden` vs `flex` class conflict is avoided by making them mutually exclusive branches (visible → flex layout, not visible → hidden only).
- `apps/web/src/components/ThreadTerminalDrawer.tsx` — terminal viewport padding changed from `p-1` to `pb-1 pr-1 pl-2 pt-2` (both single and split view) for more breathing room on top and left edges. Applies to all terminals, not just terminal threads.
