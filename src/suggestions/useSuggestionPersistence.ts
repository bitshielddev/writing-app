import { useCallback, useEffect, useRef, useState } from "react";

import type { DesktopBridge } from "../shared/desktop";
import type { PersistedSuggestionState } from "./state";

export type SuggestionPersistenceStatus =
  | { state: "idle"; acknowledgedVersion: number }
  | {
      state: "saving" | "pending" | "retrying";
      acknowledgedVersion: number;
    }
  | { state: "failed"; acknowledgedVersion: number; message: string };

type Candidate = {
  version: number;
  state: PersistedSuggestionState;
};

const SAVE_FAILURE_MESSAGE =
  "Suggestion changes may not survive an application restart.";

function immutableCopy(
  state: PersistedSuggestionState,
): PersistedSuggestionState {
  return structuredClone(state);
}

export function useSuggestionPersistence(desktop: DesktopBridge) {
  const [status, setStatus] = useState<SuggestionPersistenceStatus>({
    state: "idle",
    acknowledgedVersion: 0,
  });
  const [failureMessage, setFailureMessage] = useState<string>();
  const mountedRef = useRef(true);
  const hydratedRef = useRef(false);
  const nextVersionRef = useRef(0);
  const acknowledgedVersionRef = useRef(0);
  const activeRef = useRef<Candidate | undefined>(undefined);
  const pendingRef = useRef<Candidate | undefined>(undefined);
  const failedRef = useRef<Candidate | undefined>(undefined);
  const latestProjectionRef = useRef<PersistedSuggestionState | undefined>(
    undefined,
  );
  const hydratedEchoRef = useRef<PersistedSuggestionState | undefined>(
    undefined,
  );
  const retryingRef = useRef(false);

  const publishStatus = useCallback((next: SuggestionPersistenceStatus) => {
    if (mountedRef.current) setStatus(next);
  }, []);

  const drain = useCallback(function drainQueue() {
    if (!mountedRef.current || activeRef.current || !pendingRef.current) return;

    const candidate = pendingRef.current;
    const retrying = retryingRef.current;
    pendingRef.current = undefined;
    activeRef.current = candidate;
    retryingRef.current = false;
    publishStatus({
      state: retrying ? "retrying" : "saving",
      acknowledgedVersion: acknowledgedVersionRef.current,
    });

    void desktop.saveSuggestionState(candidate.state).then(
      () => {
        activeRef.current = undefined;
        acknowledgedVersionRef.current = candidate.version;
        failedRef.current = undefined;
        console.info(`Suggestion state save acknowledged (version ${candidate.version})`);

        if (!mountedRef.current) return;
        if (pendingRef.current) {
          publishStatus({
            state: "pending",
            acknowledgedVersion: acknowledgedVersionRef.current,
          });
          drainQueue();
          return;
        }

        setFailureMessage(undefined);
        publishStatus({
          state: "idle",
          acknowledgedVersion: acknowledgedVersionRef.current,
        });
      },
      (error: unknown) => {
        activeRef.current = undefined;
        failedRef.current = pendingRef.current ?? candidate;
        pendingRef.current = undefined;
        const detail = error instanceof Error ? error.message : String(error);
        console.error(
          `Suggestion state save failed (version ${candidate.version}): ${detail}`,
        );
        if (!mountedRef.current) return;
        setFailureMessage(SAVE_FAILURE_MESSAGE);
        publishStatus({
          state: "failed",
          acknowledgedVersion: acknowledgedVersionRef.current,
          message: detail,
        });
      },
    );
  }, [desktop, publishStatus]);

  const requestSave = useCallback(
    (state: PersistedSuggestionState) => {
      if (!hydratedRef.current || !mountedRef.current) return;
      if (hydratedEchoRef.current) {
        const isHydrationEcho =
          JSON.stringify(state) === JSON.stringify(hydratedEchoRef.current);
        hydratedEchoRef.current = undefined;
        if (isHydrationEcho) return;
      }
      const candidate = {
        version: ++nextVersionRef.current,
        state: immutableCopy(state),
      };
      latestProjectionRef.current = candidate.state;
      pendingRef.current = candidate;

      if (activeRef.current) {
        publishStatus({
          state: "pending",
          acknowledgedVersion: acknowledgedVersionRef.current,
        });
        return;
      }

      // A new local projection supersedes a failed one and is itself a user-
      // controlled request to try persistence again.
      failedRef.current = undefined;
      drain();
    },
    [drain, publishStatus],
  );

  const seedHydratedState = useCallback((state: PersistedSuggestionState) => {
    hydratedRef.current = true;
    latestProjectionRef.current = immutableCopy(state);
    hydratedEchoRef.current = immutableCopy(state);
    nextVersionRef.current = 0;
    acknowledgedVersionRef.current = 0;
    pendingRef.current = undefined;
    failedRef.current = undefined;
    retryingRef.current = false;
    if (mountedRef.current) {
      setFailureMessage(undefined);
      setStatus({ state: "idle", acknowledgedVersion: 0 });
    }
  }, []);

  const retry = useCallback(() => {
    if (
      !mountedRef.current ||
      activeRef.current ||
      pendingRef.current ||
      !failedRef.current
    ) {
      return;
    }
    pendingRef.current = failedRef.current;
    retryingRef.current = true;
    drain();
  }, [drain]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return {
    status,
    failureMessage,
    requestSave,
    seedHydratedState,
    retry,
  };
}
