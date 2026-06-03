import { ChevronRightIcon, PlusIcon } from "lucide-react";
import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useCanGoBack,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useCallback, useEffect, useMemo } from "react";

import { Button } from "../components/ui/button";
import { SidebarInset, SidebarTrigger } from "../components/ui/sidebar";
import { isElectron } from "../env";

interface Crumb {
  label: string;
  to?: string;
}

function useBreadcrumbs(pathname: string): { crumbs: Crumb[]; upPath: string } {
  return useMemo(() => {
    const segments = pathname.replace(/^\//, "").split("/");

    if (segments.length <= 2) {
      const sectionLabel = sectionLabelFor(segments[1]);
      return {
        crumbs: [{ label: "Settings", to: "/settings" }, { label: sectionLabel }],
        upPath: "/",
      };
    }

    const section = segments[1]!;
    const sub = segments[2]!;
    const sectionPath = `/settings/${section}`;

    return {
      crumbs: [
        { label: "Settings", to: "/settings" },
        { label: sectionLabelFor(section), to: sectionPath },
        { label: subPageLabel(section, sub) },
      ],
      upPath: sectionPath,
    };
  }, [pathname]);
}

function sectionLabelFor(segment: string | undefined): string {
  switch (segment) {
    case "general":
      return "General";
    case "appearance":
      return "Appearance";
    case "keybindings":
      return "Keybindings";
    case "providers":
      return "Providers";
    case "source-control":
      return "Source Control";
    case "connections":
      return "Connections";
    case "commands":
      return "Commands";
    case "hooks":
      return "Hooks";
    case "diagnostics":
      return "Diagnostics";
    case "archived":
      return "Archive";
    default:
      return "Settings";
  }
}

function subPageLabel(section: string, segment: string): string {
  if (section === "commands") {
    return segment === "new" ? "New command" : "Edit command";
  }
  switch (segment) {
    case "new":
      return "New hook";
    case "adopt":
      return "Adopt hook";
    default:
      return "Edit hook";
  }
}

function BreadcrumbNav({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav className="flex items-center gap-1 text-sm" aria-label="Breadcrumb">
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={crumb.label} className="flex items-center gap-1">
            {i > 0 && <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground/40" />}
            {crumb.to && !isLast ? (
              <Link
                to={crumb.to}
                className="font-medium text-muted-foreground/70 transition-colors hover:text-foreground"
              >
                {crumb.label}
              </Link>
            ) : (
              <span
                className={
                  isElectron
                    ? "font-medium text-muted-foreground/70"
                    : "font-medium text-foreground"
                }
              >
                {crumb.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

function SettingsContentLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const showAddHook =
    location.pathname === "/settings/hooks" || location.pathname === "/settings/hooks/";
  const showCancelHook = location.pathname.startsWith("/settings/hooks/") && !showAddHook;
  const showAddCommand =
    location.pathname === "/settings/commands" || location.pathname === "/settings/commands/";
  const showCancelCommand = location.pathname.startsWith("/settings/commands/") && !showAddCommand;
  const { crumbs, upPath } = useBreadcrumbs(location.pathname);

  const navigateBackWithinApp = useCallback(() => {
    if (upPath !== "/") {
      void navigate({ to: upPath, replace: true });
      return;
    }
    if (canGoBack) {
      window.history.back();
      return;
    }
    void navigate({ to: "/" });
  }, [canGoBack, navigate, upPath]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        navigateBackWithinApp();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [navigateBackWithinApp]);

  const actionButtons = (
    <>
      {showAddHook ? (
        <Button size="xs" variant="outline" render={<Link to="/settings/hooks/new" />}>
          <PlusIcon className="size-3" />
          Add hook
        </Button>
      ) : null}
      {showCancelHook ? (
        <Button size="xs" variant="outline" render={<Link to="/settings/hooks" />}>
          Cancel
        </Button>
      ) : null}
      {showAddCommand ? (
        <Button size="xs" variant="outline" render={<Link to="/settings/commands/new" />}>
          <PlusIcon className="size-3" />
          Add command
        </Button>
      ) : null}
      {showCancelCommand ? (
        <Button size="xs" variant="outline" render={<Link to="/settings/commands" />}>
          Cancel
        </Button>
      ) : null}
    </>
  );
  const hasActions = showAddHook || showCancelHook || showAddCommand || showCancelCommand;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {!isElectron && (
          <header className="border-b border-border px-3 py-2 sm:px-5">
            <div className="flex min-h-7 items-center gap-2 sm:min-h-6">
              <SidebarTrigger className="size-7 shrink-0 md:hidden" />
              <BreadcrumbNav crumbs={crumbs} />
              {hasActions ? (
                <div className="ms-auto flex items-center gap-2">{actionButtons}</div>
              ) : null}
            </div>
          </header>
        )}

        {isElectron && (
          <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5 wco:h-[env(titlebar-area-height)] wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]">
            <BreadcrumbNav crumbs={crumbs} />
            {hasActions ? (
              <div className="ms-auto flex items-center gap-2">{actionButtons}</div>
            ) : null}
          </div>
        )}

        <div className="min-h-0 flex flex-1 flex-col">
          <Outlet />
        </div>
      </div>
    </SidebarInset>
  );
}

function SettingsRouteLayout() {
  return <SettingsContentLayout />;
}

export const Route = createFileRoute("/settings")({
  beforeLoad: async ({ context, location }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }

    if (location.pathname === "/settings") {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: SettingsRouteLayout,
});
