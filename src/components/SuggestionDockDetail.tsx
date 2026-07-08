import {
  ArrowLeft,
  CircleAlert,
  FileText,
  PanelRightOpen,
  PanelsTopLeft,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";

import type { InboxEntry } from "../suggestions/inbox";
import {
  isVisualSuggestion,
  supportsSuggestionPreview,
  supportsWorkspacePlacement,
  type SuggestionItem,
} from "../domain/suggestions/schema";
import { KindBadge, SuggestionVisual } from "./SuggestionPresentation";

type SuggestionDockDetailProps = {
  entry: InboxEntry;
  pinned: boolean;
  activePreviewId?: string;
  onBack: () => void;
  onDismiss: () => void;
  onPinToggle: () => void;
  onPlaceOnWorkspace: (item: SuggestionItem) => void;
  onPreview: (item: SuggestionItem) => void;
};

function SourceLabels({ labels }: { labels: string[] }) {
  if (!labels.length) return null;
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

export function SuggestionDockDetail({
  entry,
  pinned,
  activePreviewId,
  onBack,
  onDismiss,
  onPinToggle,
  onPlaceOnWorkspace,
  onPreview,
}: SuggestionDockDetailProps) {
  const { item } = entry;
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
            <p>
              This suggestion was withdrawn by the agent. An existing preview
              remains yours to accept or cancel.
            </p>
          </div>
        ) : entry.stale ? (
          <div className="mt-5 flex gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>
              The agent refined this item after your preview was created. Your
              editable preview was not changed.
            </p>
          </div>
        ) : null}

        <div className="mt-6 rounded-xl border border-[#dedbe9] bg-white/75 p-5 text-[0.95rem] leading-7 text-[#393844] shadow-sm shadow-slate-900/5">
          {item.body}
        </div>

        {isVisualSuggestion(item) ? (
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
            {pinned && supportsWorkspacePlacement(item) ? (
              <button
                type="button"
                className="hidden min-h-10 items-center gap-2 rounded-md border border-brand-300 bg-white px-3 text-sm font-semibold text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-45 xl:inline-flex"
                disabled={previewIsActive}
                onClick={() => onPlaceOnWorkspace(item)}
              >
                <PanelsTopLeft className="size-4" aria-hidden="true" />
                Place on workspace
              </button>
            ) : null}
            {supportsSuggestionPreview(item) ? (
              <button
                type="button"
                className="inline-flex min-h-11 items-center gap-2 rounded-md bg-brand-600 px-4 text-sm font-semibold text-white shadow-md shadow-brand-600/15 hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-[#aaa6bd] disabled:shadow-none"
                disabled={entry.withdrawn || Boolean(activePreviewId)}
                onClick={() => onPreview(item)}
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
