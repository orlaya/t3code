# UNTANGLE -- Merge Resolutions

---

## `apps/web/src/routes/settings.tsx`

### Policy

We keep `SidebarTrigger` visible on desktop — no `md:hidden`. This applies across every `SidebarTrigger` call site in our fork (see `tweakings.md` → "Desktop sidebar toggle"). If upstream re-adds `md:hidden` in any form, we remove it.

The wrapper div's responsive classes are fair game — accept upstream's additions.

### Active resolution — 2026-04-18 merge (upstream PR #1710)

Upstream added `min-h-7 ... sm:min-h-6` to the header wrapper and kept `md:hidden` on `SidebarTrigger`. Our tweak from commit `22742fcc` removed `md:hidden`.

Take upstream's wrapper div classes; drop their `md:hidden`.

Final state for the conflict region:

```tsx
<header className="border-b border-border px-3 py-2 sm:px-5">
  <div className="flex min-h-7 items-center gap-2 sm:min-h-6">
    <SidebarTrigger className="size-7 shrink-0" />
    <span className="text-sm font-medium text-foreground">Settings</span>
```

---

## `apps/web/src/components/chat/ChatComposer.tsx`

### Policy (composer footer region)

Our fork renders the footer controls **flat and always-visible**. See `tweakings.md` → "Composer footer narrow-screen redesign".

Stable stance:

- **No compact branching.** The `isComposerFooterCompact ? <CompactComposerControlsMenu /> : (<>…flat…</>)` structure is gone. Our flat `<ComposerFooterModeControls />` + `{providerTraitsPicker}` render unconditionally at every width.
- **No `sr-only sm:not-sr-only` label hiding.** Text labels are always visible; icons drop below 640px via `hidden sm:inline`.
- **Separators stay always-visible** — `className="mx-0.5 h-4"` (not `mx-0.5 hidden h-4 sm:block`).
- **`renderProviderTraitsMenuContent` and `CompactComposerControlsMenu` imports stay commented out** with the "preserved for possible restore" note. Don't let upstream uncomment them.
- **Adopt upstream feature props.** When upstream adds new props to `ComposerFooterModeControls` (e.g. `showInteractionModeToggle`), we plumb them through to our single flat call site — we don't discard the feature, we just apply it inside our simplified structure.

### Active resolution 2a — 2026-04-18 merge (upstream PR #1758)

**Region:** the Build/Plan toggle button inside `ComposerFooterModeControls` (around line 180 of the function body).

Upstream gated the button on a new `props.showInteractionModeToggle` prop (opencode provider has no interaction modes, so it passes `false`). Our tweak from commit `bb4201e9` simplified the button's responsive classes.

Adopt upstream's gate; keep our classes inside it.

```tsx
{props.showInteractionModeToggle ? (
  <>
    <Button
      variant="ghost"
      className="shrink-0 whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:px-3"
      size="sm"
      type="button"
      onClick={props.onToggleInteractionMode}
      title={
        props.interactionMode === "plan"
          ? "Plan mode — click to return to normal build mode"
          : "Default mode — click to enter plan mode"
      }
    >
      <BotIcon className="hidden sm:inline" />
      <span>{props.interactionMode === "plan" ? "Plan" : "Build"}</span>
    </Button>

    <Separator orientation="vertical" className="mx-0.5 h-4" />
  </>
) : null}
```

The `ComposerFooterModeControls` prop type signature gains `showInteractionModeToggle: boolean` as the first field. Upstream added this to their version of the signature; auto-merge should apply it to our signature without a conflict hunk, but verify during the rebase pause.

### Active resolution 2b — 2026-04-18 merge (upstream PR #1758)

**Region:** inside the outer `{providerTraitsPicker ? (<>…</>) : null}` branch (around line 1975–2005 of the file).

Upstream wedged a second `<ComposerFooterModeControls>` call inside this branch, along with a nested redundant `providerTraitsPicker ?` check. Our commit `bb4201e9` had already gutted the compact/non-compact branching, so our branch contains just a separator + the traits picker.

Keep our gutted body. Upstream's inserted `<ComposerFooterModeControls>` inside this branch is discarded — our existing flat `<ComposerFooterModeControls>` call lives **below** this branch and renders unconditionally.

Final state for the conflict region:

```tsx
{providerTraitsPicker ? (
  <>
    <Separator orientation="vertical" className="mx-0.5 hidden h-4 sm:block" />
    {providerTraitsPicker}
  </>
) : null}
<ComposerFooterModeControls
  showInteractionModeToggle={composerProviderControls.showInteractionModeToggle}
  interactionMode={interactionMode}
  runtimeMode={runtimeMode}
  showPlanToggle={showPlanSidebarToggle}
  planSidebarLabel={planSidebarLabel}
  planSidebarOpen={planSidebarOpen}
  onToggleInteractionMode={toggleInteractionMode}
  onRuntimeModeChange={handleRuntimeModeChange}
  onTogglePlanSidebar={togglePlanSidebar}
/>
```

Note the `showInteractionModeToggle={composerProviderControls.showInteractionModeToggle}` prop added to our existing flat call. This will NOT come through auto-merge — we have to add it by hand, because our call site was an addition-by-ours that auto-merge won't touch.

### Notes / evolution

- If upstream's `showInteractionModeToggle` gets renamed or supplanted by a different mechanism, update the Policy block and add a fresh Active resolution dated to that merge.
- If upstream ever substantially rethinks the composer footer layout (e.g. removes the compact menu themselves), revisit the Policy — our simplification may converge with theirs and some of this doc becomes moot.
