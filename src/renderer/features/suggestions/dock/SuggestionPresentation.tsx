import {
  FilePenLine,
  Network,
  StickyNote,
  type LucideIcon,
} from "lucide-react";

import {
  isDiagramSuggestion,
  type SuggestionItem,
  type SuggestionKind,
} from "../../../../domain/suggestions/schema";
import { MermaidDiagram } from "./MermaidDiagram";

type KindPresentation = {
  label: string;
  icon: LucideIcon;
  tone: string;
};

const kindPresentation: Record<SuggestionKind, KindPresentation> = {
  edit: { label: "Edit", icon: FilePenLine, tone: "text-brand-700 bg-brand-100" },
  note: { label: "Note", icon: StickyNote, tone: "text-sky-800 bg-sky-100" },
  diagram: { label: "Diagram", icon: Network, tone: "text-fuchsia-800 bg-fuchsia-100" },
};

/**
 * What: renders the kind badge component and wires its props into the surrounding UI.
 *
 * Why: suggestion UI and state flows need consistent presentation and mutation behavior.
 * Called when: used by WorkspacePinCard, SuggestionDockDetail, SuggestionDockQueue and QueueRow when that path needs this behavior.
 */
export function KindBadge({ kind }: { kind: SuggestionKind }) {
  const presentation = kindPresentation[kind];
  const Icon = presentation.icon;
  return (
    <span
      className={`inline-flex min-h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-bold ${presentation.tone}`}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {presentation.label}
    </span>
  );
}

/**
 * What: renders the suggestion visual component and wires its props into the surrounding UI.
 *
 * Why: suggestion UI and state flows need consistent presentation and mutation behavior.
 * Called when: used by WorkspacePinCard and SuggestionDockDetail when that path needs this behavior.
 */
export function SuggestionVisual({ item }: { item: SuggestionItem }) {
  if (isDiagramSuggestion(item)) {
    return (
      <MermaidDiagram
        source={item.mermaidSource}
        title={item.title}
        description={item.accessibleDescription}
      />
    );
  }

  return null;
}
