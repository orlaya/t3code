# PLAN: Surface Thinking Blocks in the Timeline

## Problem

When Claude's thinking/extended thinking is enabled, the API sends back `thinking_delta` content blocks. The `ClaudeAdapter` correctly receives and classifies these as `"reasoning_text"` (via `streamKindFromDeltaType()` at line 672). However, `ProviderRuntimeIngestion.ts` at line ~1000 **drops them entirely**:

```typescript
const assistantDelta =
  event.type === "content.delta" && event.payload.streamKind === "assistant_text"
    ? event.payload.delta
    : undefined;
```

Only `"assistant_text"` passes through. The thinking tokens are never dispatched as orchestration commands, never persisted, and never reach the web UI. The user sees nothing — just the working indicator dots while the model deliberates.

## Goal

Show the primary agent's thinking as a **collapsible, streaming block inline in the conversation timeline**. Visually muted (faded colour, italic). Capped to a max height matching the work log, with show more / show less to expand. Reuses the work log visual shell but titled "Thinking" instead of "Work log".

Primary agent only — sub-agent thinking is not surfaced.

---

## Approach: Thinking as a Separate Streaming Message

Treat thinking blocks as their own message (separate from the assistant response), with a new role or content kind, streaming in via the existing delta mechanism. This avoids needing to restructure `OrchestrationMessage` into content blocks.

---

## Changes by Layer

### 1. Contracts (`packages/contracts/src/orchestration.ts`)

**OrchestrationMessageRole** — add `"thinking"` as a new role:
Currently the role is likely `"user" | "assistant" | "system"`. Add `"thinking"` so we can create thinking messages that stream independently.

**Or alternatively** — add an optional `contentKind` field to the existing delta command:

```
ThreadMessageAssistantDeltaCommand (line ~641) currently:
  type, commandId, threadId, messageId, delta, turnId?, createdAt

Could add: contentKind?: "assistant_text" | "reasoning_text"
```

The role approach is probably cleaner — a thinking message is a distinct timeline entry, not part of the assistant message.

**Decision needed:** New role vs contentKind discriminator on deltas. New role is simpler for the UI to handle as a separate timeline row.

### 2. Server — ProviderRuntimeIngestion (`apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`)

**Stop dropping reasoning_text** — around line 999, add a parallel path for reasoning_text deltas:

```
- Extract reasoning delta (similar to assistantDelta but for streamKind === "reasoning_text")
- Generate a thinking message ID: `thinking:${turnId}` (one thinking message per turn)
- Dispatch thread.message.assistant.delta (or a new thinking delta command) with the thinking text
```

The thinking message should be scoped to the current turn so it follows the same lifecycle.

**Primary agent filtering** — this is the open question. Currently there's no parent/child agent distinction in the runtime events. Options:

- If sub-agents run in separate threads, they'd have different threadIds — filtering is automatic
- If sub-agents run in the same thread, we'd need to check if the event comes from a spawned task vs the primary turn
- Need to investigate: do sub-agent thinking deltas even arrive at this same ingestion point, or do they go through a separate pipeline?

### 3. Server — Orchestration Decider (`apps/server/src/orchestration/decider.ts`)

If using the existing `thread.message.assistant.delta` command with a role/kind discriminator, the decider needs to:

- Create a new thinking message entry (with role "thinking" and streaming: true) on first delta
- Append deltas to it
- Mark streaming: false on completion

If using a brand new command type, define the command schema and handler.

### 4. Server — Persistence

The thinking message gets persisted like any other `OrchestrationMessage`, just with role `"thinking"`. It'll show up in the thread detail snapshot. No schema changes needed beyond the new role value.

### 5. Web — Types (`apps/web/src/types.ts`)

`ChatMessage` — the `role` field needs to accept `"thinking"` in addition to existing roles. No other field changes — it already has `text`, `streaming`, `createdAt`, etc.

### 6. Web — Session Logic (`apps/web/src/session-logic.ts`)

**`deriveTimelineEntries()`** (line ~1015) — thinking messages become timeline entries just like other messages. No special handling needed here, they sort by createdAt naturally.

**Lifecycle filtering** — thinking messages should only be visible during the active turn (same as work log entries). Add a filter: if the turn is complete, exclude thinking messages. This matches the "visible while deliberating, gone after" behaviour.

### 7. Web — Timeline Logic (`apps/web/src/components/chat/MessagesTimeline.logic.ts`)

**`MessagesTimelineRow`** (line ~14) — add a new row kind:

```
| {
    kind: "thinking";
    id: string;
    createdAt: string;
    message: ChatMessage;  // role === "thinking", text is the thinking content
  }
```

**`deriveMessagesTimelineRows()`** (line ~110) — when encountering a message with role "thinking", emit a `kind: "thinking"` row instead of a `kind: "message"` row.

### 8. Web — UI Components (`apps/web/src/components/chat/MessagesTimeline.browser.tsx`)

**New: ThinkingSection component** — modelled on `WorkGroupSection` (line ~527):

```
- Outer shell: same rounded-xl border styling as WorkGroupSection
- Header: "Thinking" label (same 9px uppercase tracking style)
- Show more / Show less button (same styling)
- Max height constraint (CSS max-h with overflow-hidden)
- Content: the thinking text rendered with ChatMarkdown but with muted/italic styling
- While streaming: grows up to max height, then user can expand
- After streaming complete: stays at max height, expandable
```

**Styling:**

- Text: muted foreground, italic — something like `text-muted-foreground/60 italic`
- The existing `workToneClass("thinking")` already gives `text-muted-foreground/50` — we can align with that
- Font size slightly smaller than normal message text

**Rendering in timeline:** In the main row rendering switch, handle `kind: "thinking"` by rendering `<ThinkingSection>`.

---

## File Inventory

Server:

- `packages/contracts/src/orchestration.ts` — message role or delta command changes
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts` — stop dropping reasoning_text, dispatch thinking deltas
- `apps/server/src/orchestration/decider.ts` — handle thinking message creation/deltas/completion

Web:

- `apps/web/src/types.ts` — ChatMessage role type
- `apps/web/src/session-logic.ts` — thinking message lifecycle filtering
- `apps/web/src/components/chat/MessagesTimeline.logic.ts` — new thinking row kind
- `apps/web/src/components/chat/MessagesTimeline.browser.tsx` — ThinkingSection component

Possibly:

- `apps/server/src/persistence/` — only if the persistence layer validates message roles strictly

## Open Questions

1. **Primary vs sub-agent** — how do sub-agent events flow? Same thread or separate? This determines whether filtering is needed at ingestion or if it's automatic.
2. **New role vs new command** — is adding `"thinking"` to the message role the right approach, or should thinking be its own parallel data structure entirely (not a message)?
3. **Persistence** — do we even want to persist thinking messages? If they're only visible during the active turn and filtered out after, persisting them is wasted storage. Could keep them in-memory only on the web client, fed purely by streaming deltas with no persistence.
4. **Thinking completion signal** — how do we know a thinking block is done? The Claude SDK sends `content_block_stop` for thinking blocks. Need to verify the ClaudeAdapter emits a corresponding event we can hook into.
