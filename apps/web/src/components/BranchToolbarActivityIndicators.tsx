import { memo } from "react";

import { cn } from "~/lib/utils";
import { Separator } from "./ui/separator";

type IndicatorStatus = "active" | "idle" | "hidden";

interface ActivityIndicator {
  key: string;
  label: string;
  shortLabel: string;
  status: IndicatorStatus;
  count?: number;
  onToggle: () => void;
}

interface BranchToolbarActivityIndicatorsProps {
  indicators: ActivityIndicator[];
}

export const BranchToolbarActivityIndicators = memo(function BranchToolbarActivityIndicators({
  indicators,
}: BranchToolbarActivityIndicatorsProps) {
  const visible = indicators.filter((i) => i.status !== "hidden");
  if (visible.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5">
      {visible.map((indicator, idx) => (
        <span key={indicator.key} className="flex items-center gap-1.5">
          {idx > 0 && <Separator orientation="vertical" className="h-3!" />}
          <button
            type="button"
            onClick={indicator.onToggle}
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-md border border-transparent px-[calc(--spacing(2)-1px)] text-sm font-medium transition-colors sm:h-6 sm:text-xs",
              "hover:bg-accent",
              indicator.status === "active"
                ? "text-muted-foreground/70"
                : "text-muted-foreground/70",
            )}
          >
            {indicator.status === "active" && (
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
              </span>
            )}
            <span className="hidden sm:inline">{indicator.label}</span>
            <span className="sm:hidden">{indicator.shortLabel}</span>
            {indicator.count != null && indicator.count > 0 && (
              <span
                className={cn(
                  "min-w-4 rounded-full px-1 text-center text-[10px] font-medium leading-4",
                  indicator.status === "active"
                    ? "bg-primary/15 text-primary"
                    : "bg-muted/80 text-muted-foreground/60",
                )}
              >
                {indicator.count}
              </span>
            )}
          </button>
        </span>
      ))}
    </div>
  );
});

export type { ActivityIndicator, IndicatorStatus, BranchToolbarActivityIndicatorsProps };
