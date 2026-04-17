# TWEAKINGS

**Shrink-to-narrow window support:**

- `apps/desktop/src/main.ts:1930-1931` — Electron `minWidth: 430, minHeight: 400` (was 840/620, then 400/400).
- `apps/web/src/components/AppSidebarLayout.tsx:9` — `THREAD_MAIN_CONTENT_MIN_WIDTH` set to `25*16`. Note: this constant only governs sidebar-drag behaviour, not any CSS min-width.

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
