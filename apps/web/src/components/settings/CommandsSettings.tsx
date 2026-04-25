import { useNavigate } from "@tanstack/react-router";

import { useSettings } from "../../hooks/useSettings";
import { SettingsPageContainer } from "./settingsLayout";

// ── Main component ──────────────────────────────────────────────

export function CommandsSettings() {
  const settings = useSettings();
  const navigate = useNavigate();
  const commands = settings.customSlashCommands;

  return (
    <SettingsPageContainer>
      <div className="relative overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-sm/4 not-dark:bg-clip-padding before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:shadow-none dark:before:shadow-[0_-1px_--theme(--color-white/6%)]">
        {commands.length === 0 ? (
          <div className="px-4 py-8 text-center sm:px-5">
            <p className="py-3 text-sm text-muted-foreground/80">Create a saved prompt shortcut.</p>
          </div>
        ) : null}

        {commands.map((cmd) => (
          <div
            key={cmd.name}
            className="group cursor-pointer border-t border-border/60 first:border-t-0"
            onClick={() =>
              void navigate({
                to: "/settings/commands/$commandName",
                params: { commandName: cmd.name },
              })
            }
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                void navigate({
                  to: "/settings/commands/$commandName",
                  params: { commandName: cmd.name },
                });
              }
            }}
            role="button"
            tabIndex={0}
          >
            <div className="flex items-center justify-between px-4 py-3 sm:px-5">
              <div className="min-w-0 flex-1 space-y-0.5">
                <span className="text-[13px] font-semibold tracking-[-0.01em] text-foreground">
                  /{cmd.name}
                </span>
                <p className="text-xs text-muted-foreground/80">{cmd.description}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </SettingsPageContainer>
  );
}
