import {
  ChevronRight,
  Lightbulb,
  Pin,
  PinOff,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef } from "react";

import type { AgentStatus } from "../../../../contracts/desktop-bridge";
import type { InboxEntry, PinnedInboxEntry } from "../inbox";
import { SUGGESTION_ENTRY_LIMIT } from "../../../../domain/suggestions/state";
import { KindBadge } from "./SuggestionPresentation";

type StatusPresentation = {
  summary: string;
  emptyMessage: string;
  working: boolean;
};

const STATUS_PRESENTATION: Record<AgentStatus, StatusPresentation> = {
  offline: {
    summary: "Agent unavailable",
    emptyMessage: "Suggestions will appear here when they arrive",
    working: false,
  },
  stopped: {
    summary: "Agent stopped",
    emptyMessage: "Start the agent when you’re ready",
    working: false,
  },
  working: {
    summary: "Considering your draft…",
    emptyMessage: "The agent is considering your draft",
    working: true,
  },
  waiting: {
    summary: "Waiting for changes",
    emptyMessage: "Suggestions will appear here when they arrive",
    working: false,
  },
  capped: {
    summary: "Autonomous loop capped",
    emptyMessage: "Suggestions will appear here when they arrive",
    working: false,
  },
  error: {
    summary: "Agent error",
    emptyMessage: "Suggestions will appear here when they arrive",
    working: false,
  },
};

type QueueRowProps = {
  entry: InboxEntry;
  pinned: boolean;
  keyboardActive: boolean;
  openButtonRef: (element: HTMLButtonElement | null) => void;
  onSelect: () => void;
  onPinToggle: () => void;
  onTarget: () => void;
};

/**
 * What: renders the queue row component and wires its props into the surrounding UI.
 *
 * Why: suggestion UI and state flows need consistent presentation and mutation behavior.
 * Called when: used by SuggestionDockQueue when that path needs this behavior.
 */
function QueueRow({
  entry,
  pinned,
  keyboardActive,
  openButtonRef,
  onSelect,
  onPinToggle,
  onTarget,
}: QueueRowProps) {
  const { item } = entry;
  return (
    <article
      className={`group relative rounded-xl border bg-white/75 shadow-sm shadow-slate-900/5 transition hover:border-brand-300 hover:bg-white ${
        keyboardActive
          ? "border-brand-400 ring-2 ring-brand-500/25"
          : "border-[#dedbe9]"
      } ${entry.disabledReason ? "opacity-60 grayscale" : ""}`}
    >
      {!entry.viewed ? (
        <span
          className="absolute top-5 right-14 z-10 size-2 rounded-full bg-brand-500"
          aria-label="Unread"
        />
      ) : null}
      <button
        ref={openButtonRef}
        type="button"
        aria-label={`Open ${item.title}`}
        className="w-full rounded-xl px-4 py-4 pr-12 text-left"
        onClick={() => {
          onTarget();
          onSelect();
        }}
        onFocus={onTarget}
      >
        <KindBadge kind={item.kind} />
        <h3 className="mt-3 text-sm font-bold leading-5 text-[#20212a]">
          {item.title}
        </h3>
        <p className="mt-1.5 line-clamp-2 text-sm leading-5 text-[#686577]">
          {item.summary}
        </p>
        {entry.disabledReason ? (
          <p className="mt-2 text-xs font-semibold text-slate-600">
            Disabled: source text changed
          </p>
        ) : null}
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="truncate text-xs text-[#8b8798]">
            {item.sourceLabels[0] ?? "From the evolving draft"}
          </span>
          <ChevronRight
            className="size-4 shrink-0 text-[#aaa6bd] transition group-hover:translate-x-0.5 group-hover:text-brand-600"
            aria-hidden="true"
          />
        </div>
      </button>
      <button
        type="button"
        aria-label={`${pinned ? "Unpin" : "Pin"} ${item.title}`}
        aria-pressed={pinned}
        className={`absolute top-3 right-3 grid size-9 place-items-center rounded-md transition ${
          pinned
            ? "bg-brand-100 text-brand-700 hover:bg-brand-200"
            : "text-[#777386] hover:bg-brand-50 hover:text-brand-700"
        }`}
        onClick={onPinToggle}
        onFocus={onTarget}
      >
        {pinned ? (
          <PinOff className="size-4" aria-hidden="true" />
        ) : (
          <Pin className="size-4" aria-hidden="true" />
        )}
      </button>
    </article>
  );
}

type SuggestionDockQueueProps = {
  entries: InboxEntry[];
  pinnedEntries: PinnedInboxEntry[];
  unreadCount: number;
  status: AgentStatus;
  error?: string;
  keyboardTargetId?: string;
  onKeyboardTargetChange: (id: string) => void;
  onSelect: (id: string) => void;
  onPin: (id: string) => void;
  onUnpin: (id: string) => void;
};

/**
 * What: renders the suggestion dock queue component and wires its props into the surrounding UI.
 *
 * Why: suggestion UI and state flows need consistent presentation and mutation behavior.
 * Called when: used by SuggestionDock and DockContent when that path needs this behavior.
 */
export function SuggestionDockQueue({
  entries,
  pinnedEntries,
  unreadCount,
  status,
  error,
  keyboardTargetId,
  onKeyboardTargetChange,
  onSelect,
  onPin,
  onUnpin,
}: SuggestionDockQueueProps) {
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const presentation = STATUS_PRESENTATION[status];

  useEffect(() => {
    if (!keyboardTargetId) return;
    const row = rowRefs.current.get(keyboardTargetId);
    row?.focus();
    row?.scrollIntoView?.({ block: "nearest" });
  }, [keyboardTargetId]);

  /**
   * What: performs the row ref step for this file's workflow.
   *
   * Why: suggestion UI and state flows need consistent presentation and mutation behavior.
   * Called when: used by SuggestionDockQueue when that path needs this behavior.
   */
  const rowRef = (id: string) => (element: HTMLButtonElement | null) => {
    if (element) rowRefs.current.set(id, element);
    else rowRefs.current.delete(id);
  };

  return (
    <div className="px-5 py-6 2xl:px-7 2xl:py-7">
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-lg bg-brand-600 text-white">
            <Sparkles className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-lg font-extrabold text-[#1a1b22]">
              Writing partner
            </h2>
            <p className="mt-0.5 text-xs font-semibold text-[#777386]">
              {presentation.summary}
            </p>
          </div>
        </div>
        {unreadCount ? (
          <span className="inline-flex min-h-7 min-w-7 items-center justify-center rounded-full bg-brand-600 px-2 text-xs font-bold text-white">
            <span className="sr-only">Unread suggestions: </span>
            {unreadCount}
          </span>
        ) : null}
      </header>

      {error ? (
        <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <p>{error}</p>
        </div>
      ) : null}

      {pinnedEntries.length ? (
        <section aria-labelledby="pinned-suggestions-title" className="mt-7">
          <div className="flex items-center justify-between gap-3">
            <h2
              id="pinned-suggestions-title"
              className="text-xs font-extrabold tracking-[0.1em] text-brand-700 uppercase"
            >
              Pins
            </h2>
            <span className="text-xs font-semibold text-[#8b8798]">
              {pinnedEntries.length}
            </span>
          </div>
          <div className="mt-4 grid gap-3">
            {pinnedEntries.map((entry) => (
              <QueueRow
                key={entry.item.id}
                entry={entry}
                pinned
                keyboardActive={keyboardTargetId === entry.item.id}
                openButtonRef={rowRef(entry.item.id)}
                onSelect={() => onSelect(entry.item.id)}
                onPinToggle={() => onUnpin(entry.item.id)}
                onTarget={() => onKeyboardTargetChange(entry.item.id)}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="suggestion-inbox-title" className="mt-7">
        <div className="flex items-center justify-between gap-3">
          <h2
            id="suggestion-inbox-title"
            className="text-xs font-extrabold tracking-[0.1em] text-[#686577] uppercase"
          >
            Suggestion inbox
          </h2>
          <span className="text-xs font-semibold text-[#8b8798]">
            {entries.length} of {SUGGESTION_ENTRY_LIMIT}
          </span>
        </div>

        <div className="mt-4 grid gap-3">
          {entries.map((entry) => (
            <QueueRow
              key={entry.item.id}
              entry={entry}
              pinned={false}
              keyboardActive={keyboardTargetId === entry.item.id}
              openButtonRef={rowRef(entry.item.id)}
              onSelect={() => onSelect(entry.item.id)}
              onPinToggle={() => onPin(entry.item.id)}
              onTarget={() => onKeyboardTargetChange(entry.item.id)}
            />
          ))}
          {!entries.length ? (
            <div className="grid min-h-44 place-items-center rounded-xl border border-dashed border-[#c9c5dc] bg-white/35 px-6 text-center">
              <div>
                {presentation.working ? (
                  <Sparkles
                    className="mx-auto size-7 text-brand-500"
                    aria-hidden="true"
                  />
                ) : (
                  <Lightbulb
                    className="mx-auto size-7 text-[#aaa6bd]"
                    aria-hidden="true"
                  />
                )}
                <p className="mt-3 text-sm font-semibold text-[#5d5b6d]">
                  {presentation.emptyMessage}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
