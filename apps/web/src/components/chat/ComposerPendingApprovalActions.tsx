import { type ApprovalRequestId, type ProviderApprovalDecision } from "@t3tools/contracts";
import { memo } from "react";
import { CheckCheckIcon, CheckIcon, XIcon } from "lucide-react";

interface ComposerPendingApprovalActionsProps {
  requestId: ApprovalRequestId;
  isResponding: boolean;
  onRespondToApproval: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<void>;
}

const ACTION_CLASSES =
  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-foreground/85 transition-colors duration-100 cursor-pointer select-none disabled:opacity-40 disabled:cursor-default hover:bg-white/10";

export const ComposerPendingApprovalActions = memo(function ComposerPendingApprovalActions({
  requestId,
  isResponding,
  onRespondToApproval,
}: ComposerPendingApprovalActionsProps) {
  return (
    <>
      <button
        type="button"
        className={ACTION_CLASSES}
        disabled={isResponding}
        onClick={() => void onRespondToApproval(requestId, "decline")}
      >
        <XIcon className="size-3.5 text-destructive-foreground" />
        Reject
      </button>
      <button
        type="button"
        className={ACTION_CLASSES}
        disabled={isResponding}
        onClick={() => void onRespondToApproval(requestId, "acceptForSession")}
      >
        <CheckCheckIcon className="size-3.5 text-success-foreground" />
        Always Allow This Session
      </button>
      <button
        type="button"
        className={ACTION_CLASSES}
        disabled={isResponding}
        onClick={() => void onRespondToApproval(requestId, "accept")}
      >
        <CheckIcon className="size-3.5 text-success-foreground" />
        Allow
      </button>
    </>
  );
});
