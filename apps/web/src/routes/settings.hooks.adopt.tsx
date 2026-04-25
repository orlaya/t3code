import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type {
  HookAction,
  HookMatcherGroup,
  ManagedHookEntry,
  ManagedHookFile,
} from "@t3tools/contracts";
import { fingerprintAction } from "@t3tools/shared/claudeHooksFingerprint";

import { HookEditForm } from "../components/settings/HookEditForm";
import { SettingsPageContainer } from "../components/settings/settingsLayout";
import { getPrimaryEnvironmentConnection } from "../environments/runtime";
import { useServerConfig } from "../rpc/serverState";
import { parseAdoptSearch } from "./settings.hooks.search";
export type { AdoptSearch } from "./settings.hooks.search";

interface Located {
  file: ManagedHookFile;
  event: string;
  matcher: string | undefined;
  action: HookAction;
}

function AdoptHookRoute() {
  const { level, fingerprint, cwd: searchCwd } = Route.useSearch();
  const navigate = useNavigate();
  const serverConfig = useServerConfig();
  // Global hooks don't have an owning cwd — fall back to the session cwd
  // just so the RPC accepts the call; project data it returns is ignored.
  const fetchCwd = searchCwd || (serverConfig?.cwd ?? "");

  const [located, setLocated] = useState<Located | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!fetchCwd || !fingerprint) return;
    let cancelled = false;
    void getPrimaryEnvironmentConnection()
      .client.claudeHooks.get({ cwd: fetchCwd })
      .then((data) => {
        if (cancelled) return;
        const unmanaged = data[level].unmanaged;
        for (const file of ["committed", "local"] as const) {
          const events = unmanaged[file];
          for (const [event, groups] of Object.entries(events)) {
            for (const group of groups as HookMatcherGroup[]) {
              for (const action of group.hooks) {
                if (fingerprintAction(event, group.matcher, action) === fingerprint) {
                  setLocated({ file, event, matcher: group.matcher, action });
                  setLoading(false);
                  return;
                }
              }
            }
          }
        }
        setMissing(true);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchCwd, level, fingerprint]);

  useEffect(() => {
    if (missing) void navigate({ to: "/settings/hooks", replace: true });
  }, [missing, navigate]);

  if (loading || !located) {
    return (
      <SettingsPageContainer>
        <div className="px-4 py-12 text-center">
          <p className="text-sm text-muted-foreground/60">Loading hook...</p>
        </div>
      </SettingsPageContainer>
    );
  }

  const initialHook: ManagedHookEntry = {
    name: "",
    draft: false,
    file: located.file,
    event: located.event as ManagedHookEntry["event"],
    ...(located.matcher !== undefined ? { matcher: located.matcher } : {}),
    action: located.action,
  };

  return (
    <HookEditForm
      initialHook={initialHook}
      initialLevel={level}
      adoptFingerprint={fingerprint}
      {...(searchCwd ? { initialCwd: searchCwd } : {})}
    />
  );
}

export const Route = createFileRoute("/settings/hooks/adopt")({
  validateSearch: parseAdoptSearch,
  component: AdoptHookRoute,
});
