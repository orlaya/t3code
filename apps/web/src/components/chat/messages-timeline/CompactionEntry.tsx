import { memo } from "react";
import { CheckIcon, LoaderIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import type { WorkLogEntry } from "../../../session-logic/index";

/** Compaction entry — styled like a sub-agent task with colored background. */
export const CompactionEntry = memo(function CompactionEntry({
  workEntry,
}: {
  workEntry: WorkLogEntry;
}) {
  const inProgress = workEntry.isCompacting === true;
  const label = workEntry.label ?? "Context compacted";

  return (
    <div
      className={cn(
        "flex w-full items-center gap-1.5 rounded-md px-3 py-0.5",
        inProgress ? "bg-primary/5" : "bg-muted/40",
      )}
    >
      {inProgress ? (
        <LoaderIcon className="size-4 shrink-0 animate-spin [animation-duration:4s] text-primary/70" />
      ) : (
        <CheckIcon className="size-4 shrink-0 text-primary/70" />
      )}
      <p
        className={cn(
          "truncate text-[13px] leading-5 py-2",
          inProgress ? "text-foreground/90" : "font-medium text-foreground/80",
        )}
      >
        {label}
      </p>
    </div>
  );
});
