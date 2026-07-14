import { type RefObject, useEffect, useRef } from "react";

import type { AgentActivity, AgentRuntime } from "../../../../contracts/desktop-bridge";
import { AgentActivityList } from "../../agent/AgentActivityList";
import type { InboxEntry, PinnedInboxEntry } from "../inbox";
import type { SuggestionItem } from "../../../../domain/suggestions/schema";
import type { SuggestionControllerStatus } from "../useSuggestionController";
import { SuggestionDockDetail } from "./SuggestionDockDetail";
import { SuggestionDockQueue } from "./SuggestionDockQueue";

type SuggestionDockProps = {
  entries: InboxEntry[];
  pinnedEntries: PinnedInboxEntry[];
  selectedEntry?: InboxEntry;
  activePreviewId?: string;
  unreadCount: number;
  error?: string;
  persistenceStatus: SuggestionControllerStatus;
  persistenceError?: string;
  activity?: AgentActivity[];
  runtime: AgentRuntime;
  controlPending?: "start" | "stop";
  view: "suggestions" | "activity";
  keyboardTargetId?: string;
  regionRef?: RefObject<HTMLElement | null>;
  onViewChange: (view: "suggestions" | "activity") => void;
  onKeyboardTargetChange: (id: string) => void;
  onSelect: (id: string) => void;
  onBack: () => void;
  onDismiss: (id: string) => void;
  onPin: (id: string) => void;
  onUnpin: (id: string) => void;
  onPlaceOnWorkspace: (item: SuggestionItem) => void;
  onPreview: (item: SuggestionItem) => void;
  onAccept: (item: SuggestionItem) => void;
  onStartAgent: () => void;
  onStopAgent: () => void;
  onRetrySuggestionSave: () => void;
};

/**
 * What: renders the dock toolbar component and wires its props into the surrounding UI.
 *
 * Why: suggestion UI and state flows need consistent presentation and mutation behavior.
 * Called when: used by SuggestionDock when that path needs this behavior.
 */
function DockToolbar({
  runtime,
  controlPending,
  view,
  onViewChange,
  onStartAgent,
  onStopAgent,
}: Pick<
  SuggestionDockProps,
  | "runtime"
  | "controlPending"
  | "view"
  | "onViewChange"
  | "onStartAgent"
  | "onStopAgent"
>) {
  const agentIsEnabled =
    runtime.status !== "offline" && runtime.status !== "stopped";
  let controlLabel = agentIsEnabled ? "Stop Agent" : "Start Agent";
  if (controlPending === "start") controlLabel = "Starting…";
  if (controlPending === "stop") controlLabel = "Stopping…";

  return (
    <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-panel/95 p-2 backdrop-blur">
        <nav
          className="grid min-w-0 flex-1 grid-cols-2"
          aria-label="Writing partner views"
        >
          <button
            type="button"
            aria-current={view === "suggestions" ? "page" : undefined}
            className={`min-h-9 rounded-md text-sm font-bold ${
              view === "suggestions"
                ? "bg-surface-raised text-brand-700 shadow-sm"
                : "text-muted-foreground"
            }`}
            onClick={() => onViewChange("suggestions")}
          >
            Suggestions
          </button>
          <button
            type="button"
            aria-current={view === "activity" ? "page" : undefined}
            className={`min-h-9 rounded-md text-sm font-bold ${
              view === "activity"
                ? "bg-surface-raised text-brand-700 shadow-sm"
                : "text-muted-foreground"
            }`}
            onClick={() => onViewChange("activity")}
          >
            Activity
          </button>
        </nav>
        <button
          type="button"
          disabled={runtime.status === "offline" || Boolean(controlPending)}
          className={`min-h-9 shrink-0 rounded-md px-3 text-xs font-extrabold transition disabled:cursor-not-allowed disabled:opacity-50 ${
            agentIsEnabled
              ? "border border-border bg-surface-raised text-muted-foreground hover:border-danger hover:text-danger"
              : "bg-brand-600 text-primary-foreground shadow-sm hover:bg-brand-700"
          }`}
          onClick={agentIsEnabled ? onStopAgent : onStartAgent}
        >
          {controlLabel}
        </button>
    </div>
  );
}

/**
 * What: renders the dock content component and wires its props into the surrounding UI.
 *
 * Why: suggestion UI and state flows need consistent presentation and mutation behavior.
 * Called when: used by SuggestionDock when that path needs this behavior.
 */
function DockContent(props: SuggestionDockProps) {
  const {
    entries,
    pinnedEntries,
    selectedEntry,
    activePreviewId,
    unreadCount,
    error,
    runtime,
    view,
    keyboardTargetId,
    onKeyboardTargetChange,
    onSelect,
    onBack,
    onDismiss,
    onPin,
    onUnpin,
    onPlaceOnWorkspace,
    onPreview,
    onAccept,
  } = props;
  const activity = props.activity ?? [];
  const selectedIsPinned = selectedEntry
    ? pinnedEntries.some((entry) => entry.item.id === selectedEntry.item.id)
    : false;

  if (view === "activity") {
    return <AgentActivityList items={activity} runtime={runtime} />;
  }
  if (selectedEntry) {
    return (
      <SuggestionDockDetail
        entry={selectedEntry}
        pinned={selectedIsPinned}
        activePreviewId={activePreviewId}
        onBack={onBack}
        onDismiss={() => onDismiss(selectedEntry.item.id)}
        onPinToggle={() =>
          selectedIsPinned
            ? onUnpin(selectedEntry.item.id)
            : onPin(selectedEntry.item.id)
        }
        onPlaceOnWorkspace={onPlaceOnWorkspace}
        onPreview={onPreview}
        onAccept={onAccept}
      />
    );
  }
  return (
    <SuggestionDockQueue
      entries={entries}
      pinnedEntries={pinnedEntries}
      unreadCount={unreadCount}
      status={runtime.status}
      error={error}
      keyboardTargetId={keyboardTargetId}
      onKeyboardTargetChange={onKeyboardTargetChange}
      onSelect={onSelect}
      onPin={onPin}
      onUnpin={onUnpin}
    />
  );
}

/**
 * What: renders the suggestion dock component and wires its props into the surrounding UI.
 *
 * Why: suggestion UI and state flows need consistent presentation and mutation behavior.
 * Called when: used by App, renderDock and DockHarness when that path needs this behavior.
 */
export function SuggestionDock(props: SuggestionDockProps) {
  const localDockRef = useRef<HTMLElement>(null);
  const dockRef = props.regionRef ?? localDockRef;

  useEffect(() => {
    if (typeof dockRef.current?.scrollTo === "function") {
      dockRef.current.scrollTo({ top: 0 });
    }
  }, [dockRef, props.selectedEntry?.item.id]);

  return (
    <aside
      ref={dockRef}
      tabIndex={props.regionRef ? -1 : undefined}
      aria-label="Writing partner"
      className="h-full min-h-0 overflow-y-auto border-l border-border bg-panel"
    >
      <p className="sr-only" aria-live="polite">
        Agent status: {props.runtime.status}
        {props.runtime.error ? `. ${props.runtime.error}` : ""}
      </p>
      <DockToolbar {...props} />
      {props.persistenceError ? (
        <div
          role="alert"
          className="m-3 flex items-center justify-between gap-3 rounded-md border border-danger bg-danger/10 p-3 text-sm text-danger"
        >
          <span>{props.persistenceError}</span>
          <button
            type="button"
            disabled={props.persistenceStatus.state !== "failed"}
            className="shrink-0 rounded-md border border-danger bg-surface-raised px-3 py-1.5 font-bold disabled:cursor-wait disabled:opacity-60"
            onClick={props.onRetrySuggestionSave}
          >
            Retry
          </button>
        </div>
      ) : null}
      <DockContent {...props} />
    </aside>
  );
}
