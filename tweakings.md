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

- Hidden the standalone "Add action" button in `ProjectScriptsControl.tsx:342-349` (the else branch when no scripts exist — now `: null`). Dropdown "Add action" menu item when scripts DO exist is kept.
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

**ChatHeader sidebar toggle visual parity:**

- `SidebarTrigger` at `ChatHeader.tsx:61` now passes `variant="outline" size="icon-xs" className="shrink-0 [&_svg]:size-3"` to match the Terminal and Diff `<Toggle variant="outline" size="xs">` buttons next to it. Works because `SidebarTrigger` spreads `...props` after its `size="icon" variant="ghost"` defaults, so caller props win.

**Theme colors:**

- `index.css:99,110,128,139` — `--primary` and `--ring` changed from `oklch(0.488 0.217 264)` blue to `#F5B162` orange. Applied to both light and dark roots.
- `index.css:107,136` — `--destructive` changed from `var(--color-red-500)` / `color-mix(...)` dark to `#eb889f` (muted pink-red). Applied to both themes.
- `ComposerPrimaryActions.tsx:113` — stop/interrupt button switched from hardcoded `bg-rose-500/90 hover:bg-rose-500` to `bg-destructive/90 hover:bg-destructive` (semantic token). Tweaking `--destructive` in `index.css` now moves the stop button too.
- `--primary-foreground` kept as white and `--destructive-foreground` kept as `red-700`/`red-400`. Potential follow-ups if contrast reads poorly on the new base colors.

**Badge outline variant breathing room + No Git removal:**

- `ui/badge.tsx:28-29` — outline variant gained `h-6 px-2 sm:h-5 sm:px-1.5` to override the default size's tighter dimensions. Slight bump on both axes with horizontal > vertical. Affects the project-name badge in the chat header and the "model" badge in the command menu.
- `ChatHeader.tsx:77-81` — "No Git" badge commented out (not deleted). `isGitRepo` prop is still used to disable the Diff toggle.
