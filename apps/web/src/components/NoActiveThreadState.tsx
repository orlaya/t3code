import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { SidebarInset, SidebarTrigger, useSidebar } from "./ui/sidebar";
import { isElectron } from "../env";
import { cn } from "~/lib/utils";

export function NoActiveThreadState() {
  const { state, isMobile } = useSidebar();
  const reserveTrafficLightInset = state === "collapsed" || isMobile;
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <header
          className={cn(
            "border-b border-border pr-3 sm:pr-5",
            isElectron
              ? cn(
                  "drag-region flex h-[52px] items-center wco:h-[env(titlebar-area-height)]",
                  reserveTrafficLightInset
                    ? "pl-[82px] wco:pl-[calc(env(titlebar-area-x)+1em)]"
                    : "pl-3 sm:pl-5",
                )
              : "pl-3 py-2 sm:pl-5 sm:py-3",
          )}
        >
          {isElectron ? (
            <div className="flex items-center gap-2 wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]">
              <SidebarTrigger className="size-7 shrink-0" />
              <span className="text-xs text-muted-foreground/50">No active thread</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <SidebarTrigger className="size-7 shrink-0" />
              <span className="text-sm font-medium text-foreground md:text-muted-foreground/60">
                No active thread
              </span>
            </div>
          )}
        </header>

        <Empty className="flex-1">
          <div className="w-full max-w-lg rounded-3xl border border-border/55 bg-card/20 px-8 py-12 shadow-sm/5">
            <EmptyHeader className="max-w-none">
              <EmptyTitle className="text-foreground text-xl">Pick a thread to continue</EmptyTitle>
              <EmptyDescription className="mt-2 text-sm text-muted-foreground/78">
                Select an existing thread or create a new one to get started.
              </EmptyDescription>
            </EmptyHeader>
          </div>
        </Empty>
      </div>
    </SidebarInset>
  );
}
