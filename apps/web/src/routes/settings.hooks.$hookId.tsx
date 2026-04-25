import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { HooksLevel, ManagedHookEntry } from "@t3tools/contracts";

import { HookEditForm } from "../components/settings/HookEditForm";
import { SettingsPageContainer } from "../components/settings/settingsLayout";
import { getPrimaryEnvironmentConnection } from "../environments/runtime";
import { useServerConfig } from "../rpc/serverState";
import { parseEditHookSearch } from "./settings.hooks.search";
export type { EditHookSearch } from "./settings.hooks.search";

interface Located {
  level: HooksLevel;
  hook: ManagedHookEntry;
}

function EditHookRoute() {
  const { hookId } = Route.useParams();
  const { cwd: searchCwd, level: searchLevel } = Route.useSearch();
  const navigate = useNavigate();
  const serverConfig = useServerConfig();
  // For global hooks, the server still needs a non-empty cwd to resolve
  // project-level reads — they'll be discarded. Fall back to the current
  // session cwd when the link didn't carry one.
  const fetchCwd = searchCwd || (serverConfig?.cwd ?? "");

  const [located, setLocated] = useState<Located | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!fetchCwd) return;
    let cancelled = false;
    void getPrimaryEnvironmentConnection()
      .client.claudeHooks.get({ cwd: fetchCwd })
      .then((data) => {
        if (cancelled) return;
        const bucket = searchLevel === "global" ? data.global : data.project;
        const hook = bucket.managed[hookId];
        if (hook) {
          setLocated({ level: searchLevel, hook });
        } else {
          // Fallback: scan the other bucket in case the search hint was stale.
          const other = searchLevel === "global" ? data.project : data.global;
          const otherHook = other.managed[hookId];
          if (otherHook) {
            setLocated({
              level: searchLevel === "global" ? "project" : "global",
              hook: otherHook,
            });
          } else {
            setMissing(true);
          }
        }
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchCwd, hookId, searchLevel]);

  useEffect(() => {
    if (missing) {
      void navigate({ to: "/settings/hooks", replace: true });
    }
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

  return (
    <HookEditForm
      hookId={hookId}
      initialHook={located.hook}
      initialLevel={located.level}
      {...(searchCwd ? { initialCwd: searchCwd } : {})}
    />
  );
}

export const Route = createFileRoute("/settings/hooks/$hookId")({
  validateSearch: parseEditHookSearch,
  component: EditHookRoute,
});
