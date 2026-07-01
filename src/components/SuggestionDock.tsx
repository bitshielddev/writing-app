import {
  ArrowLeft,
  ChevronRight,
  CircleAlert,
  FileText,
  Lightbulb,
  PanelRightOpen,
  PanelsTopLeft,
  Pin,
  PinOff,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { AgentActivity, AgentRuntime } from "../shared/desktop";
import type { InboxEntry, PinnedInboxEntry } from "../suggestions/inbox";
import type {
  AgentStatus,
  SuggestionItem,
} from "../suggestions/types";
import { KindBadge, SuggestionVisual } from "./SuggestionPresentation";

type SuggestionDockProps = {
  entries: InboxEntry[];
  pinnedEntries: PinnedInboxEntry[];
  selectedEntry?: InboxEntry;
  activePreviewId?: string;
  unreadCount: number;
  status: AgentStatus;
  error?: { message: string; recoverable: boolean };
  activity?: AgentActivity[];
  runtime?: AgentRuntime;
  onSelect: (id: string) => void;
  onBack: () => void;
  onDismiss: (id: string) => void;
  onPin: (id: string) => void;
  onUnpin: (id: string) => void;
  onPlaceOnWorkspace: (item: SuggestionItem) => void;
  onPreview: (item: SuggestionItem) => void;
};

function ActivityView({
  items,
  runtime,
}: {
  items: AgentActivity[];
  runtime?: AgentRuntime;
}) {
  return (
    <div className="px-5 py-6 2xl:px-7 2xl:py-7">
      <header>
        <h2 className="text-lg font-extrabold text-[#1a1b22]">Agent activity</h2>
        <p className="mt-1 text-xs font-semibold text-[#777386]">
          {runtime?.status ?? "offline"} · cycle {runtime?.cycleCount ?? 0}
          {runtime?.activeRevision === undefined ? "" : ` · revision ${runtime.activeRevision}`}
        </p>
      </header>
      <ol className="mt-5 grid gap-3" aria-label="Agent activity log">
        {items.map((item) => (
          <li key={item.id} className="rounded-lg border border-[#dedbe9] bg-white/75 p-3">
            <div className="flex items-start justify-between gap-3">
              <span className="text-[0.65rem] font-extrabold tracking-[0.08em] text-brand-700 uppercase">
                {item.kind}
              </span>
              <time className="text-[0.65rem] text-[#8b8798]" dateTime={new Date(item.timestamp).toISOString()}>
                {new Date(item.timestamp).toLocaleTimeString()}
              </time>
            </div>
            <h3 className="mt-1.5 text-sm font-bold text-[#292a34]">{item.title}</h3>
            {item.text ? (
              <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-5 text-[#5d5b6d]">
                {item.text}
              </p>
            ) : null}
            {item.payload !== undefined ? (
              <details className="mt-2 text-xs text-[#686577]">
                <summary className="cursor-pointer font-semibold">Raw payload</summary>
                <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-[#efedf7] p-2">
                  {JSON.stringify(item.payload, null, 2)}
                </pre>
              </details>
            ) : null}
          </li>
        ))}
        {!items.length ? (
          <li className="rounded-xl border border-dashed border-[#c9c5dc] bg-white/35 px-5 py-10 text-center text-sm text-[#686577]">
            Activity from this app launch will appear here.
          </li>
        ) : null}
      </ol>
    </div>
  );
}

function SourceLabels({ labels }: { labels: string[] }) {
  if (!labels.length) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Sources">
      {labels.map((label) => (
        <span
          key={label}
          className="inline-flex min-h-7 items-center gap-1.5 rounded-md border border-[#dedbe9] bg-white/65 px-2 text-xs text-[#686577]"
        >
          <FileText className="size-3.5" aria-hidden="true" />
          {label}
        </span>
      ))}
    </div>
  );
}

function QueueRow({
  entry,
  pinned,
  onSelect,
  onPinToggle,
}: {
  entry: InboxEntry;
  pinned: boolean;
  onSelect: () => void;
  onPinToggle: () => void;
}) {
  const { item } = entry;
  return (
    <article className="group relative rounded-xl border border-[#dedbe9] bg-white/75 shadow-sm shadow-slate-900/5 transition hover:border-brand-300 hover:bg-white">
      {!entry.viewed ? (
        <span
          className="absolute top-5 right-14 z-10 size-2 rounded-full bg-brand-500"
          aria-label="Unread"
        />
      ) : null}
      <button
        type="button"
        aria-label={`Open ${item.title}`}
        className="w-full rounded-xl px-4 py-4 pr-12 text-left"
        onClick={onSelect}
      >
        <KindBadge kind={item.kind} />
        <h3 className="mt-3 text-sm font-bold leading-5 text-[#20212a]">
          {item.title}
        </h3>
        <p className="mt-1.5 line-clamp-2 text-sm leading-5 text-[#686577]">
          {item.summary}
        </p>
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

function DetailView({
  entry,
  pinned,
  activePreviewId,
  onBack,
  onDismiss,
  onPinToggle,
  onPlaceOnWorkspace,
  onPreview,
}: {
  entry: InboxEntry;
  pinned: boolean;
  activePreviewId?: string;
  onBack: () => void;
  onDismiss: () => void;
  onPinToggle: () => void;
  onPlaceOnWorkspace: () => void;
  onPreview: () => void;
}) {
  const { item } = entry;
  const isTextSuggestion =
    item.kind === "snippet" || item.kind === "fact" || item.kind === "term";
  const previewIsActive = activePreviewId === item.id;
  const anotherPreviewIsActive = Boolean(activePreviewId && !previewIsActive);

  return (
    <div className="min-h-full px-5 py-5 2xl:px-7 2xl:py-7">
      <button
        type="button"
        className="inline-flex min-h-10 items-center gap-2 rounded-md px-2 text-sm font-semibold text-[#5d5b6d] hover:bg-white/70 hover:text-brand-700"
        onClick={onBack}
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to suggestions
      </button>

      <article className="mx-auto mt-5 max-w-2xl">
        <KindBadge kind={item.kind} />
        <h2 className="mt-5 text-2xl font-extrabold tracking-[-0.025em] text-[#1a1b22]">
          {item.title}
        </h2>
        <p className="mt-3 text-base font-medium leading-7 text-[#4d4b59]">
          {item.summary}
        </p>

        {entry.withdrawn ? (
          <div className="mt-5 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>This suggestion was withdrawn by the agent. An existing preview remains yours to accept or cancel.</p>
          </div>
        ) : entry.stale ? (
          <div className="mt-5 flex gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>The agent refined this item after your preview was created. Your editable preview was not changed.</p>
          </div>
        ) : null}

        <div className="mt-6 rounded-xl border border-[#dedbe9] bg-white/75 p-5 text-[0.95rem] leading-7 text-[#393844] shadow-sm shadow-slate-900/5">
          {item.body}
        </div>

        {item.kind === "outline" || item.kind === "layout" || item.kind === "mindMap" ? (
          <div className="mt-5">
            <SuggestionVisual item={item} />
          </div>
        ) : null}

        <div className="mt-5">
          <SourceLabels labels={item.sourceLabels} />
        </div>

        {pinned ? (
          <p className="mt-5 text-xs font-semibold text-[#777386] xl:hidden">
            Workspace placement is available in the desktop layout.
          </p>
        ) : null}

        <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-[#dedbe9] pt-5">
          <button
            type="button"
            className="inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-semibold text-[#686577] hover:bg-white hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-45"
            disabled={previewIsActive}
            onClick={onDismiss}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Dismiss
          </button>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              className="inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-semibold text-brand-700 hover:bg-white"
              onClick={onPinToggle}
            >
              {pinned ? (
                <PinOff className="size-4" aria-hidden="true" />
              ) : (
                <Pin className="size-4" aria-hidden="true" />
              )}
              {pinned ? "Unpin" : "Pin"}
            </button>
            {pinned ? (
              <button
                type="button"
                className="hidden min-h-10 items-center gap-2 rounded-md border border-brand-300 bg-white px-3 text-sm font-semibold text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-45 xl:inline-flex"
                disabled={previewIsActive}
                onClick={onPlaceOnWorkspace}
              >
                <PanelsTopLeft className="size-4" aria-hidden="true" />
                Place on workspace
              </button>
            ) : null}
            {isTextSuggestion ? (
              <button
              type="button"
              className="inline-flex min-h-11 items-center gap-2 rounded-md bg-brand-600 px-4 text-sm font-semibold text-white shadow-md shadow-brand-600/15 hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-[#aaa6bd] disabled:shadow-none"
              disabled={entry.withdrawn || Boolean(activePreviewId)}
              onClick={onPreview}
            >
              <PanelRightOpen className="size-4" aria-hidden="true" />
              {previewIsActive
                ? "Preview active"
                : anotherPreviewIsActive
                  ? "Finish current preview"
                  : "Preview in document"}
              </button>
            ) : null}
          </div>
        </div>
      </article>
    </div>
  );
}

export function SuggestionDock({
  entries,
  pinnedEntries,
  selectedEntry,
  activePreviewId,
  unreadCount,
  status,
  error,
  activity = [],
  runtime,
  onSelect,
  onBack,
  onDismiss,
  onPin,
  onUnpin,
  onPlaceOnWorkspace,
  onPreview,
}: SuggestionDockProps) {
  const dockRef = useRef<HTMLElement>(null);
  const [view, setView] = useState<"suggestions" | "activity">("suggestions");

  useEffect(() => {
    if (typeof dockRef.current?.scrollTo === "function") {
      dockRef.current.scrollTo({ top: 0 });
    }
  }, [selectedEntry?.item.id]);

  return (
    <aside
      ref={dockRef}
      aria-label="Writing partner"
      className="h-full min-h-0 overflow-y-auto border-l border-[#d7d4e8] bg-[#f4f2fd]"
    >
      <p className="sr-only" aria-live="polite">
        {runtime?.status === "error" || runtime?.status !== undefined
          ? `Agent status: ${runtime.status}${runtime.error ? `. ${runtime.error}` : ""}`
          : ""}
      </p>
      <nav className="sticky top-0 z-20 grid grid-cols-2 border-b border-[#d7d4e8] bg-[#f4f2fd]/95 p-2 backdrop-blur" aria-label="Writing partner views">
        <button
          type="button"
          aria-current={view === "suggestions" ? "page" : undefined}
          className={`min-h-9 rounded-md text-sm font-bold ${view === "suggestions" ? "bg-white text-brand-700 shadow-sm" : "text-[#686577]"}`}
          onClick={() => setView("suggestions")}
        >
          Suggestions
        </button>
        <button
          type="button"
          aria-current={view === "activity" ? "page" : undefined}
          className={`min-h-9 rounded-md text-sm font-bold ${view === "activity" ? "bg-white text-brand-700 shadow-sm" : "text-[#686577]"}`}
          onClick={() => setView("activity")}
        >
          Activity
        </button>
      </nav>
      {view === "activity" ? (
        <ActivityView items={activity} runtime={runtime} />
      ) : selectedEntry ? (
        <DetailView
          entry={selectedEntry}
          pinned={pinnedEntries.some(
            (entry) => entry.item.id === selectedEntry.item.id,
          )}
          activePreviewId={activePreviewId}
          onBack={onBack}
          onDismiss={() => onDismiss(selectedEntry.item.id)}
          onPinToggle={() =>
            pinnedEntries.some((entry) => entry.item.id === selectedEntry.item.id)
              ? onUnpin(selectedEntry.item.id)
              : onPin(selectedEntry.item.id)
          }
          onPlaceOnWorkspace={() => onPlaceOnWorkspace(selectedEntry.item)}
          onPreview={() => onPreview(selectedEntry.item)}
        />
      ) : (
        <div className="px-5 py-6 2xl:px-7 2xl:py-7">
          <header className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="grid size-9 place-items-center rounded-lg bg-brand-600 text-white">
                  <Sparkles className="size-5" aria-hidden="true" />
                </span>
                <div>
                  <h2 className="text-lg font-extrabold text-[#1a1b22]">Writing partner</h2>
                  <p className="mt-0.5 text-xs font-semibold text-[#777386]">
                    {status === "working"
                      ? "Considering your draft…"
                      : status === "offline"
                        ? "Agent unavailable"
                        : status === "waiting"
                          ? "Waiting for changes"
                          : status === "capped"
                            ? "Autonomous loop capped"
                            : "Agent error"}
                  </p>
                </div>
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
              <p>{error.message}</p>
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
                    onSelect={() => onSelect(entry.item.id)}
                    onPinToggle={() => onUnpin(entry.item.id)}
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
                {entries.length} of 30
              </span>
            </div>

            <div className="mt-4 grid gap-3">
              {entries.map((entry) => (
                <QueueRow
                  key={entry.item.id}
                  entry={entry}
                  pinned={false}
                  onSelect={() => onSelect(entry.item.id)}
                  onPinToggle={() => onPin(entry.item.id)}
                />
              ))}
              {!entries.length ? (
                <div className="grid min-h-44 place-items-center rounded-xl border border-dashed border-[#c9c5dc] bg-white/35 px-6 text-center">
                  <div>
                    {status === "working" ? (
                      <Sparkles className="mx-auto size-7 text-brand-500" aria-hidden="true" />
                    ) : (
                      <Lightbulb className="mx-auto size-7 text-[#aaa6bd]" aria-hidden="true" />
                    )}
                    <p className="mt-3 text-sm font-semibold text-[#5d5b6d]">
                      {status === "working"
                        ? "The agent is considering your draft"
                        : "Suggestions will appear here when they arrive"}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      )}
    </aside>
  );
}
