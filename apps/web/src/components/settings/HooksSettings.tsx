import { AlertTriangleIcon, PencilIcon, XCircleIcon } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type {
  ClaudeHooksAllProjectsResult,
  ClaudeHooksProjectEntry,
  HookDiagnostic,
  HooksLevel,
} from "@t3tools/contracts";

import { getPrimaryEnvironmentConnection } from "../../environments/runtime";
import { cn } from "../../lib/utils";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";
import {
  ALL_PROJECTS,
  flattenManagedLevel,
  flattenUnmanagedLevel,
  unmanagedTitle,
  type ManagedRef,
  type UnmanagedRef,
} from "./HooksSettings.logic";

// ── Diagnostics banner ──────────────────────────────────────────

function DiagnosticsBanner({ diagnostics }: { diagnostics: readonly HookDiagnostic[] }) {
  if (diagnostics.length === 0) return null;
  return (
    <>
      {diagnostics.map((d) => (
        <div
          key={`${d.severity}-${d.event ?? "file"}-${d.matcherIndex ?? ""}-${d.hookIndex ?? ""}-${d.message.slice(0, 32)}`}
          className={`flex items-start gap-2 border-t border-border/60 first:border-t-0 px-4 py-2.5 sm:px-5 ${
            d.severity === "error"
              ? "bg-destructive/5 text-destructive"
              : "bg-amber-500/5 text-amber-600 dark:text-amber-400"
          }`}
        >
          {d.severity === "error" ? (
            <XCircleIcon className="mt-0.5 size-3.5 shrink-0" />
          ) : (
            <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
          )}
          <span className="text-xs">{d.message}</span>
        </div>
      ))}
    </>
  );
}

// ── Managed hook row ────────────────────────────────────────────

function ManagedHookRow({ ref, showProjectLabel }: { ref: ManagedRef; showProjectLabel: boolean }) {
  const level: HooksLevel = ref.projectCwd === null ? "global" : "project";
  const navigate = useNavigate();

  function handleEdit() {
    void navigate({
      to: "/settings/hooks/$hookId",
      params: { hookId: ref.id },
      search: { level, cwd: ref.projectCwd ?? "" },
    });
  }

  function handleToggleDraft(checked: boolean) {
    const client = getPrimaryEnvironmentConnection().client;
    void client.claudeHooks.write({
      cwd: ref.projectCwd ?? undefined,
      hookId: ref.id,
      level,
      hook: { ...ref.hook, draft: !checked },
    });
  }

  return (
    <div className="group border-t border-border/60 first:border-t-0 hover:bg-muted/40">
      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <div className="min-w-0 flex-1 cursor-pointer space-y-0.5" onClick={handleEdit}>
          <div className="flex min-h-5 items-center gap-1.5">
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                ref.hook.draft ? "bg-muted-foreground/40" : "bg-success",
              )}
            />
            <span className="truncate text-[13px] font-semibold tracking-[-0.01em] text-foreground">
              {ref.hook.name}
            </span>
            {showProjectLabel && ref.projectTitle ? (
              <code className="text-xs text-muted-foreground">{ref.projectTitle}</code>
            ) : null}
            <PencilIcon className="size-3.5 shrink-0 text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
          {ref.hook.description ? (
            <p className="truncate text-xs text-muted-foreground/80">{ref.hook.description}</p>
          ) : null}
        </div>
        <Switch
          checked={!ref.hook.draft}
          onCheckedChange={handleToggleDraft}
          aria-label={
            ref.hook.draft ? `Activate ${ref.hook.name}` : `Set ${ref.hook.name} to draft`
          }
        />
      </div>
    </div>
  );
}

// ── Unmanaged hook row ──────────────────────────────────────────

function UnmanagedHookRow({
  ref,
  showProjectLabel,
}: {
  ref: UnmanagedRef;
  showProjectLabel: boolean;
}) {
  const level: HooksLevel = ref.projectCwd === null ? "global" : "project";
  return (
    <Link
      to="/settings/hooks/adopt"
      search={{ level, fingerprint: ref.fingerprint, cwd: ref.projectCwd ?? "" }}
      className="group block border-t border-border/60 first:border-t-0 hover:bg-muted/40"
    >
      <div className="px-4 py-3 sm:px-5">
        <div className="flex min-h-5 items-center gap-1.5">
          <span className="size-2 shrink-0 rounded-full bg-muted-foreground/40" />
          <span className="truncate text-[13px] font-semibold tracking-[-0.01em] text-foreground">
            {unmanagedTitle(ref)}
          </span>
          {showProjectLabel && ref.projectTitle ? (
            <code className="text-xs text-muted-foreground">{ref.projectTitle}</code>
          ) : null}
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground/70">
            pre-existing
          </span>
          <PencilIcon className="size-3.5 shrink-0 text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      </div>
    </Link>
  );
}

// ── Main component ──────────────────────────────────────────────

export function HooksSettings() {
  const [data, setData] = useState<ClaudeHooksAllProjectsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [projectFilter, setProjectFilter] = useState<string>(ALL_PROJECTS);

  useEffect(() => {
    const unsubscribe = getPrimaryEnvironmentConnection().client.claudeHooks.subscribe(
      {},
      (event) => {
        setData(event.payload);
        setLoading(false);
      },
    );
    return unsubscribe;
  }, []);

  const globalManaged = useMemo<ManagedRef[]>(
    () => (data ? flattenManagedLevel(data.global.managed, null, null) : []),
    [data],
  );
  const globalUnmanaged = useMemo<UnmanagedRef[]>(
    () => (data ? flattenUnmanagedLevel(data.global.unmanaged, null, null) : []),
    [data],
  );

  // Flatten project hooks across all live projects in creation order.
  const projectManaged = useMemo<ManagedRef[]>(() => {
    if (!data) return [];
    const out: ManagedRef[] = [];
    for (const project of data.projects as readonly ClaudeHooksProjectEntry[]) {
      out.push(...flattenManagedLevel(project.managed, project.cwd, project.title));
    }
    return out;
  }, [data]);

  const projectUnmanaged = useMemo<UnmanagedRef[]>(() => {
    if (!data) return [];
    const out: UnmanagedRef[] = [];
    for (const project of data.projects as readonly ClaudeHooksProjectEntry[]) {
      out.push(...flattenUnmanagedLevel(project.unmanaged, project.cwd, project.title));
    }
    return out;
  }, [data]);

  const filteredProjectManaged = useMemo(
    () =>
      projectFilter === ALL_PROJECTS
        ? projectManaged
        : projectManaged.filter((ref) => ref.projectCwd === projectFilter),
    [projectManaged, projectFilter],
  );

  const filteredProjectUnmanaged = useMemo(
    () =>
      projectFilter === ALL_PROJECTS
        ? projectUnmanaged
        : projectUnmanaged.filter((ref) => ref.projectCwd === projectFilter),
    [projectUnmanaged, projectFilter],
  );

  const projectDiagnostics = useMemo<readonly HookDiagnostic[]>(() => {
    if (!data) return [];
    if (projectFilter === ALL_PROJECTS) {
      return data.projects.flatMap((p) => p.diagnostics);
    }
    const match = data.projects.find((p) => p.cwd === projectFilter);
    return match?.diagnostics ?? [];
  }, [data, projectFilter]);

  const totalHooks =
    globalManaged.length + globalUnmanaged.length + projectManaged.length + projectUnmanaged.length;

  if (loading) {
    return (
      <SettingsPageContainer>
        <div className="px-4 py-12 text-center">
          <p className="text-sm text-muted-foreground/60">Loading hooks...</p>
        </div>
      </SettingsPageContainer>
    );
  }

  const projectFilterOptions = data?.projects ?? [];
  const hasProjectHooks = projectManaged.length > 0 || projectUnmanaged.length > 0;

  return (
    <SettingsPageContainer>
      {totalHooks === 0 ? (
        <div className="px-4 py-12 text-center sm:px-5">
          <p className="text-sm text-muted-foreground/80">
            Event-driven automation for Claude Code sessions.
          </p>
        </div>
      ) : null}

      {globalManaged.length > 0 ||
      globalUnmanaged.length > 0 ||
      data!.global.diagnostics.length > 0 ? (
        <SettingsSection title="Global">
          <DiagnosticsBanner diagnostics={data!.global.diagnostics} />
          {globalManaged.map((ref) => (
            <ManagedHookRow key={`managed-${ref.id}`} ref={ref} showProjectLabel={false} />
          ))}
          {globalUnmanaged.map((ref) => (
            <UnmanagedHookRow
              key={`unmanaged-${ref.fingerprint}`}
              ref={ref}
              showProjectLabel={false}
            />
          ))}
        </SettingsSection>
      ) : null}

      {hasProjectHooks || projectDiagnostics.length > 0 ? (
        <SettingsSection
          title="Projects"
          headerAction={
            projectFilterOptions.length > 1 ? (
              <Select
                value={projectFilter}
                onValueChange={(value) => setProjectFilter(value ?? ALL_PROJECTS)}
              >
                <SelectTrigger size="xs" variant="ghost">
                  <SelectValue>
                    {projectFilter === ALL_PROJECTS
                      ? "All projects"
                      : (projectFilterOptions.find((p) => p.cwd === projectFilter)?.title ??
                        "All projects")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="end" alignItemWithTrigger={false}>
                  <SelectItem value={ALL_PROJECTS}>All projects</SelectItem>
                  {projectFilterOptions.map((project) => (
                    <SelectItem key={project.cwd} value={project.cwd}>
                      {project.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null
          }
        >
          <DiagnosticsBanner diagnostics={projectDiagnostics} />
          {filteredProjectManaged.map((ref) => (
            <ManagedHookRow
              key={`managed-${ref.projectCwd}-${ref.id}`}
              ref={ref}
              showProjectLabel={projectFilter === ALL_PROJECTS}
            />
          ))}
          {filteredProjectUnmanaged.map((ref) => (
            <UnmanagedHookRow
              key={`unmanaged-${ref.projectCwd}-${ref.fingerprint}`}
              ref={ref}
              showProjectLabel={projectFilter === ALL_PROJECTS}
            />
          ))}
          {filteredProjectManaged.length === 0 &&
          filteredProjectUnmanaged.length === 0 &&
          projectDiagnostics.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground/60 sm:px-5">
              No hooks for this project.
            </p>
          ) : null}
        </SettingsSection>
      ) : null}
    </SettingsPageContainer>
  );
}
