# TWEAKINGS

**Shrink-to-narrow window support:**

- `apps/desktop/src/main.ts:1930-1931` — Electron `minWidth: 400, minHeight: 400` (was 840/620). Requires full app restart, not HMR.
- `apps/web/src/components/AppSidebarLayout.tsx:9` — user changed `THREAD_MAIN_CONTENT_MIN_WIDTH` to `25*16` but this constant only governs sidebar-drag behaviour, not any CSS min-width. Left as-is.

**Desktop sidebar toggle:**

- Removed `md:hidden` from every `SidebarTrigger` usage so it's visible on desktop (`ChatHeader.tsx:74`, `NoActiveThreadState.tsx:20`, `settings.tsx:37`). Also removed the redundant one from `Sidebar.tsx:1964` (was next to T3 Code wordmark) + its unused import.
- `SidebarTrigger` in `ui/sidebar.tsx` simplified to always render `PanelLeftIcon` (removed the `openMobile`-conditional swap with `PanelLeftCloseIcon`).

**macOS traffic-light clearance:**

- `NoActiveThreadState.tsx` and `ChatView.tsx` now conditionally add `pl-[90px]` when sidebar is collapsed OR in mobile mode (via `useSidebar()` → `state === "collapsed" || isMobile`). Base horizontal padding was split from `px-3 sm:px-5` into `pl-3 pr-3 sm:pl-5 sm:pr-5` to avoid Tailwind v4 class-order conflicts with the arbitrary `pl-[90px]`.

**Header button cleanup (user wanted these gone permanently):**

- Hidden the standalone "Add action" button in `ProjectScriptsControl.tsx:342-349` (the else branch when no scripts exist — now `: null`). Dropdown "Add action" menu item when scripts DO exist is kept.
- Removed `GitActionsControl` entirely from `ChatHeader.tsx` + cleaned up now-unused imports and props (`activeThreadEnvironmentId`, `activeThreadId`, `draftId`, `gitCwd`, `scopeThreadRef`, `GitActionsControl` import) and the corresponding props passed from `ChatView.tsx`. The component file + tests still exist as dead code — user chose to leave them.

**Sidebar sheet animation:**

- `ui/sidebar.tsx:230` — `SheetPopup` className includes `duration-0` (was originally 200ms transition). Mobile sidebar opens instantly.

**Keybinding for sidebar toggle:**

- `packages/contracts/src/keybindings.ts` — added `"sidebar.toggle"` to `STATIC_KEYBINDING_COMMANDS`.
- `apps/server/src/keybindings.ts` — added default `{ key: "mod+b", command: "sidebar.toggle", when: "!terminalFocus" }`.
- `apps/web/src/routes/_chat.tsx` — imports `useSidebar`, handles `"sidebar.toggle"` command by calling `toggleSidebar()`, added `toggleSidebar` to useEffect deps.
- **Contracts + server changes require dev-server restart**, not just HMR.

**Command palette / mobile sidebar fixes:**

- `Sidebar.tsx` — replaced `CommandDialogTrigger` (imported from `./ui/command`) with plain `SidebarMenuButton`. Its onClick now: `if (isMobile) setOpenMobile(false); openCommandPalette(true);`. This sidesteps a base-ui nested-dialog bug where clicking search inside the mobile sheet was closing the sheet without opening the palette. Added `useSidebar` to the import from `./ui/sidebar`, removed unused `CommandDialogTrigger` import.
- `ui/sidebar.tsx` — `SheetPopup` now has `initialFocus={() => document.querySelector('[data-testid="command-palette-trigger"]')}` so opening the sidebar via Cmd+B focuses the Search button (instead of auto-focusing the T3 wordmark Link, which was showing its version tooltip).

**Command palette positioning on mobile:**

- `ui/command.tsx:46` — `CommandDialogViewport` padding changed from `py-[max(--spacing(4),4vh)] sm:py-[10vh]` to unified `py-[max(--spacing(4),10vh)]`. Mobile now matches desktop positioning. User's backup plan if it still feels off: vertically center the palette by adding `justify-center` to the viewport.
