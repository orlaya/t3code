import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import ChatView from "../components/ChatView";
import { threadHasStarted } from "../components/ChatView.logic";
import { useComposerDraftStore, DraftId } from "../composerDraftStore";
import { SidebarInset } from "../components/ui/sidebar";
import { createThreadSelectorAcrossEnvironments } from "../storeSelectors";
import { useStore } from "../store";
import { buildThreadRouteParams } from "../threadRoutes";
import { retainThreadDetailSubscription } from "../environments/runtime/service";

function DraftChatThreadRouteView() {
  const navigate = useNavigate();
  const { draftId: rawDraftId } = Route.useParams();
  const draftId = DraftId.make(rawDraftId);
  const draftSession = useComposerDraftStore((store) => store.getDraftSession(draftId));
  const serverThread = useStore(
    useMemo(
      () => createThreadSelectorAcrossEnvironments(draftSession?.threadId ?? null),
      [draftSession?.threadId],
    ),
  );
  const serverThreadStarted = threadHasStarted(serverThread);
  // Wait until the server thread has at least one message before navigating.
  // Without this, the draft ChatView (with its optimistic user message) gets
  // torn down before the server has echoed the message back, causing a flicker
  // where the user message briefly disappears.
  const serverThreadHasMessages = serverThread !== undefined && serverThread.messages.length > 0;
  const canonicalThreadRef = useMemo(
    () =>
      draftSession?.promotedTo
        ? serverThreadStarted && serverThreadHasMessages
          ? draftSession.promotedTo
          : null
        : serverThreadHasMessages
          ? {
              environmentId: serverThread!.environmentId,
              threadId: serverThread!.id,
            }
          : null,
    [draftSession?.promotedTo, serverThread, serverThreadStarted, serverThreadHasMessages],
  );

  // Subscribe to thread detail events as soon as the server thread exists,
  // so message-sent events flow into the store and serverThreadHasMessages
  // flips promptly. Without this, the draft route never sees individual
  // message updates and waits indefinitely.
  const promotedRef = draftSession?.promotedTo ?? null;
  useEffect(() => {
    if (!promotedRef) return;
    return retainThreadDetailSubscription(promotedRef.environmentId, promotedRef.threadId);
  }, [promotedRef]);

  useEffect(() => {
    if (!canonicalThreadRef) {
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(canonicalThreadRef),
      replace: true,
    });
  }, [canonicalThreadRef, navigate]);

  useEffect(() => {
    if (draftSession || canonicalThreadRef) {
      return;
    }
    void navigate({ to: "/", replace: true });
  }, [canonicalThreadRef, draftSession, navigate]);

  if (canonicalThreadRef) {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
        <ChatView
          environmentId={canonicalThreadRef.environmentId}
          threadId={canonicalThreadRef.threadId}
          routeKind="server"
        />
      </SidebarInset>
    );
  }

  if (!draftSession) {
    return null;
  }

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <ChatView
        draftId={draftId}
        environmentId={draftSession.environmentId}
        threadId={draftSession.threadId}
        routeKind="draft"
      />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/draft/$draftId")({
  component: DraftChatThreadRouteView,
});
