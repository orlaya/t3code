import type { ComponentType } from "react";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  Link2Icon,
  PaletteIcon,
  Settings2Icon,
  TerminalSquareIcon,
  WebhookIcon,
} from "lucide-react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "../ui/sidebar";

export type SettingsSectionPath =
  | "/settings/general"
  | "/settings/appearance"
  | "/settings/connections"
  | "/settings/commands"
  | "/settings/hooks"
  | "/settings/archived";

export const SETTINGS_NAV_ITEMS: ReadonlyArray<{
  label: string;
  to: SettingsSectionPath;
  icon: ComponentType<{ className?: string }>;
}> = [
  { label: "General", to: "/settings/general", icon: Settings2Icon },
  { label: "Appearance", to: "/settings/appearance", icon: PaletteIcon },
  { label: "Connections", to: "/settings/connections", icon: Link2Icon },
  { label: "Commands", to: "/settings/commands", icon: TerminalSquareIcon },
  { label: "Hooks", to: "/settings/hooks", icon: WebhookIcon },
  { label: "Archive", to: "/settings/archived", icon: ArchiveIcon },
];

function useNavigateUp(): () => void {
  const location = useLocation();
  const navigate = useNavigate();
  const segments = location.pathname.replace(/^\//, "").split("/");
  // Sub-pages (e.g. /settings/hooks/new) → go up to /settings/hooks
  // Top-level settings pages → exit settings
  const upPath = segments.length > 2 ? `/settings/${segments[1]}` : "/";
  return () => void navigate({ to: upPath, replace: true });
}

export function SettingsSidebarNav({ pathname }: { pathname: string }) {
  const navigate = useNavigate();
  const handleBack = useNavigateUp();

  return (
    <>
      <SidebarContent className="overflow-x-hidden">
        <SidebarGroup className="px-2 py-3">
          <SidebarMenu>
            {SETTINGS_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.to;
              return (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    size="sm"
                    isActive={isActive}
                    className={
                      isActive
                        ? "gap-2.5 px-2.5 py-2 text-left text-[13px] font-medium text-foreground"
                        : "gap-2.5 px-2.5 py-2 text-left text-[13px] text-muted-foreground/70 hover:text-foreground/80"
                    }
                    onClick={() => void navigate({ to: item.to, replace: true })}
                  >
                    <Icon
                      className={
                        isActive
                          ? "size-4 shrink-0 text-foreground"
                          : "size-4 shrink-0 text-muted-foreground/60"
                      }
                    />
                    <span className="truncate">{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />
      <SidebarFooter className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="sm"
              className="gap-2 px-2 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={handleBack}
            >
              <ArrowLeftIcon className="size-4" />
              <span>Back</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </>
  );
}
