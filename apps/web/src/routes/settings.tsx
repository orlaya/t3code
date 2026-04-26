import { ChevronRightIcon, PlusIcon } from "lucide-react";
import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useCallback, useEffect, useMemo } from "react";

import { Button } from "../components/ui/button";
import { SidebarInset, SidebarTrigger } from "../components/ui/sidebar";
import { isElectron } from "../env";

// ── Breadcrumb / "navigate up" helpers ─────────────────────────────

interface Crumb {
  label: string;
  /** Navigation target. `undefined` = current page (not clickable). */
  to?: string;
}

/**
 * Derive breadcrumb segments and the "up one level" target from the
 * current pathname. The last crumb is always the current page (no link).
 */
function useBreadcrumbs(pathname: string): { crumbs: Crumb[]; upPath: string } {
  return useMemo(() => {
    // /settings/hooks/$hookId  → ["settings", "hooks", "$hookId"]
    const segments = pathname.replace(/^\//, "").split("/");

    // Top-level settings pages: Settings › <Section>
    // Escape/back exits settings entirely.
    if (segments.length <= 2) {
      const sectionLabel = sectionLabelFor(segments[1]);
      return {
        crumbs: [{ label: "Settings", to: "/settings" }, { label: sectionLabel }],
        upPath: "/",
      };
    }

    // Sub-pages (e.g. /settings/hooks/new, /settings/hooks/$hookId)
    const section = segments[1]!; // "hooks"
    const sub = segments[2]!; // "new", "$hookId", "adopt"
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
    case "connections":
      return "Connections";
    case "commands":
      return "Commands";
    case "hooks":
      return "Hooks";
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

// ── Components ─────────────────────────────────────────────────────

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
                className="font-medium text-muted-foreground/70 hover:text-foreground transition-colors"
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
  const showAddHook =
    location.pathname === "/settings/hooks" || location.pathname === "/settings/hooks/";
  const showCancelHook = location.pathname.startsWith("/settings/hooks/") && !showAddHook;
  const showAddCommand =
    location.pathname === "/settings/commands" || location.pathname === "/settings/commands/";
  const showCancelCommand = location.pathname.startsWith("/settings/commands/") && !showAddCommand;

  const { crumbs, upPath } = useBreadcrumbs(location.pathname);

  const navigateUp = useCallback(() => {
    void navigate({ to: upPath, replace: true });
  }, [navigate, upPath]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        navigateUp();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [navigateUp]);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {!isElectron && (
          <header className="border-b border-border px-3 py-2 sm:px-5">
            <div className="flex min-h-7 items-center gap-2 sm:min-h-6">
              <SidebarTrigger className="size-7 shrink-0" />
              <BreadcrumbNav crumbs={crumbs} />
              {showAddHook || showCancelHook || showAddCommand || showCancelCommand ? (
                <div className="ms-auto flex items-center gap-2">
                  {showAddHook && (
                    <Button size="xs" variant="outline" render={<Link to="/settings/hooks/new" />}>
                      <PlusIcon className="size-3" />
                      Add hook
                    </Button>
                  )}
                  {showCancelHook && (
                    <Button size="xs" variant="outline" render={<Link to="/settings/hooks" />}>
                      Cancel
                    </Button>
                  )}
                  {showAddCommand && (
                    <Button
                      size="xs"
                      variant="outline"
                      render={<Link to="/settings/commands/new" />}
                    >
                      <PlusIcon className="size-3" />
                      Add command
                    </Button>
                  )}
                  {showCancelCommand && (
                    <Button size="xs" variant="outline" render={<Link to="/settings/commands" />}>
                      Cancel
                    </Button>
                  )}
                </div>
              ) : null}
            </div>
          </header>
        )}

        {isElectron && (
          <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5 wco:h-[env(titlebar-area-height)] wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]">
            <BreadcrumbNav crumbs={crumbs} />
            {showAddHook || showCancelHook || showAddCommand || showCancelCommand ? (
              <div className="ms-auto flex items-center gap-2">
                {showAddHook && (
                  <Button size="xs" variant="outline" render={<Link to="/settings/hooks/new" />}>
                    <PlusIcon className="size-3" />
                    Add hook
                  </Button>
                )}
                {showCancelHook && (
                  <Button size="xs" variant="outline" render={<Link to="/settings/hooks" />}>
                    Cancel
                  </Button>
                )}
                {showAddCommand && (
                  <Button size="xs" variant="outline" render={<Link to="/settings/commands/new" />}>
                    <PlusIcon className="size-3" />
                    Add command
                  </Button>
                )}
                {showCancelCommand && (
                  <Button size="xs" variant="outline" render={<Link to="/settings/commands" />}>
                    Cancel
                  </Button>
                )}
              </div>
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
    if (context.authGateState.status !== "authenticated") {
      throw redirect({ to: "/pair", replace: true });
    }

    if (location.pathname === "/settings") {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: SettingsRouteLayout,
});
