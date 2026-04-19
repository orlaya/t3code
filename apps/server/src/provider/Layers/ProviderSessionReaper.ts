import { CommandId } from "@t3tools/contracts";
import { Duration, Effect, Layer, Schedule } from "effect";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import {
  ProviderSessionReaper,
  type ProviderSessionReaperShape,
} from "../Services/ProviderSessionReaper.ts";
import { ProviderService } from "../Services/ProviderService.ts";

const DEFAULT_INACTIVITY_THRESHOLD_MS = 30 * 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export interface ProviderSessionReaperLiveOptions {
  readonly inactivityThresholdMs?: number;
  readonly sweepIntervalMs?: number;
}

const makeProviderSessionReaper = (options?: ProviderSessionReaperLiveOptions) =>
  Effect.gen(function* () {
    const providerService = yield* ProviderService;
    const directory = yield* ProviderSessionDirectory;
    const orchestrationEngine = yield* OrchestrationEngineService;

    const inactivityThresholdMs = Math.max(
      1,
      options?.inactivityThresholdMs ?? DEFAULT_INACTIVITY_THRESHOLD_MS,
    );
    const sweepIntervalMs = Math.max(1, options?.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS);

    const sweep = Effect.gen(function* () {
      const readModel = yield* orchestrationEngine.getReadModel();
      const threadsById = new Map(readModel.threads.map((thread) => [thread.id, thread] as const));
      const bindings = yield* directory.listBindings();
      const now = Date.now();
      let reapedCount = 0;

      for (const binding of bindings) {
        if (binding.status === "stopped") {
          continue;
        }

        const lastSeenMs = Date.parse(binding.lastSeenAt);
        if (Number.isNaN(lastSeenMs)) {
          yield* Effect.logWarning("provider.session.reaper.invalid-last-seen", {
            threadId: binding.threadId,
            provider: binding.provider,
            lastSeenAt: binding.lastSeenAt,
          });
          continue;
        }

        const idleDurationMs = now - lastSeenMs;
        if (idleDurationMs < inactivityThresholdMs) {
          continue;
        }

        const thread = threadsById.get(binding.threadId);
        if (thread?.session?.activeTurnId != null) {
          yield* Effect.logDebug("provider.session.reaper.skipped-active-turn", {
            threadId: binding.threadId,
            activeTurnId: thread.session.activeTurnId,
            idleDurationMs,
          });
          continue;
        }

        const reaped = yield* providerService.stopSession({ threadId: binding.threadId }).pipe(
          Effect.tap(() =>
            Effect.logInfo("provider.session.reaped", {
              threadId: binding.threadId,
              provider: binding.provider,
              idleDurationMs,
              reason: "inactivity_threshold",
            }),
          ),
          Effect.as(true),
          Effect.catchCause((cause) =>
            Effect.logWarning("provider.session.reaper.stop-failed", {
              threadId: binding.threadId,
              provider: binding.provider,
              idleDurationMs,
              cause,
            }).pipe(Effect.as(false)),
          ),
        );

        if (reaped) {
          reapedCount += 1;
        }
      }

      if (reapedCount > 0) {
        yield* Effect.logInfo("provider.session.reaper.sweep-complete", {
          reapedCount,
          totalBindings: bindings.length,
        });
      }
    });

    /**
     * Reconcile orphaned sessions: threads whose orchestration read model claims
     * a live session but whose provider process is actually dead.
     *
     * This handles the case where a provider process dies silently (e.g. laptop
     * sleep, OOM) without emitting a `session.exited` event, leaving the read
     * model permanently stale.
     */
    const reconcile = Effect.gen(function* () {
      const readModel = yield* orchestrationEngine.getReadModel();
      const liveSessions = yield* providerService.listSessions();
      const liveThreadIds = new Set(liveSessions.map((s) => s.threadId));

      const NON_TERMINAL_STATUSES = new Set([
        "idle",
        "starting",
        "running",
        "ready",
        "interrupted",
      ]);

      let reconciledCount = 0;

      for (const thread of readModel.threads) {
        if (!thread.session) continue;
        if (!NON_TERMINAL_STATUSES.has(thread.session.status)) continue;
        if (liveThreadIds.has(thread.id)) continue;

        // This thread thinks it has a live session, but no provider process exists.
        const now = new Date().toISOString();
        const previousStatus = thread.session.status;
        yield* orchestrationEngine
          .dispatch({
            type: "thread.session.set",
            commandId: CommandId.make(`server:session-reconcile:${crypto.randomUUID()}`),
            threadId: thread.id,
            session: {
              threadId: thread.id,
              status: "stopped",
              providerName: thread.session.providerName ?? null,
              runtimeMode: thread.session.runtimeMode,
              activeTurnId: null,
              lastError: null,
              updatedAt: now,
            },
            createdAt: now,
          })
          .pipe(
            Effect.tap(() =>
              Effect.logInfo("provider.session.reconciled", {
                threadId: thread.id,
                previousStatus,
                reason: "orphaned_session",
              }),
            ),
            Effect.catchCause((cause) =>
              Effect.logWarning("provider.session.reconcile.dispatch-failed", {
                threadId: thread.id,
                cause,
              }),
            ),
          );

        reconciledCount += 1;
      }

      if (reconciledCount > 0) {
        yield* Effect.logInfo("provider.session.reaper.reconcile-complete", {
          reconciledCount,
          totalThreads: readModel.threads.length,
        });
      }
    });

    const start: ProviderSessionReaperShape["start"] = () =>
      Effect.gen(function* () {
        yield* Effect.forkScoped(
          Effect.all([sweep, reconcile]).pipe(
            Effect.catch((error: unknown) =>
              Effect.logWarning("provider.session.reaper.sweep-failed", {
                error,
              }),
            ),
            Effect.catchDefect((defect: unknown) =>
              Effect.logWarning("provider.session.reaper.sweep-defect", {
                defect,
              }),
            ),
            Effect.repeat(Schedule.spaced(Duration.millis(sweepIntervalMs))),
          ),
        );

        yield* Effect.logInfo("provider.session.reaper.started", {
          inactivityThresholdMs,
          sweepIntervalMs,
        });
      });

    return {
      start,
      reconcile: () =>
        reconcile.pipe(
          Effect.catchDefect((defect: unknown) =>
            Effect.logWarning("provider.session.reaper.reconcile-defect", {
              defect,
            }),
          ),
        ),
    } satisfies ProviderSessionReaperShape;
  });

export const makeProviderSessionReaperLive = (options?: ProviderSessionReaperLiveOptions) =>
  Layer.effect(ProviderSessionReaper, makeProviderSessionReaper(options));

export const ProviderSessionReaperLive = makeProviderSessionReaperLive();
