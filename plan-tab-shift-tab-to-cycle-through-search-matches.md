# Plan: Tab/Shift+Tab to cycle through search matches

## Context

The SearchOverlay input currently lets Tab move focus to the chevron buttons, which is clunky. Tab and Shift+Tab should cycle through matches (same as Enter/Shift+Enter), keeping focus in the input.

## Change

**File:** `apps/web/src/components/SearchOverlay.tsx`

In `handleKeyDown`, add a case for `Tab`:

- `e.key === "Tab"` → `e.preventDefault()`, then call `onNext()` or `onPrev()` depending on `e.shiftKey`
- Identical logic to the existing `Enter` handler

Also add `tabIndex={-1}` to the three buttons so they're removed from the tab order entirely (they're still clickable, just not tab-focusable).

## Verification

- Open search overlay (Cmd+F)
- Type a query
- Press Tab → should go to next match (same as Enter)
- Press Shift+Tab → should go to previous match (same as Shift+Enter)
- Focus should stay in the input at all times
- Chevron/X buttons should still work when clicked
