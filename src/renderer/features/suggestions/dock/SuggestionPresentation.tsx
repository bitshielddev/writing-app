import {
  BookOpenText,
  GitBranch,
  ListTree,
  Network,
  Quote,
  Tag,
  type LucideIcon,
} from "lucide-react";

import {
  isMindMapSuggestion,
  isStructureSuggestion,
  type StructureNode,
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
  snippet: { label: "Snippet", icon: Quote, tone: "text-brand-700 bg-brand-100" },
  fact: { label: "Fact", icon: BookOpenText, tone: "text-sky-800 bg-sky-100" },
  term: { label: "Terminology", icon: Tag, tone: "text-emerald-800 bg-emerald-100" },
  outline: { label: "Outline", icon: ListTree, tone: "text-indigo-800 bg-indigo-100" },
  layout: { label: "Layout", icon: GitBranch, tone: "text-amber-800 bg-amber-100" },
  mindMap: { label: "Mind map", icon: Network, tone: "text-fuchsia-800 bg-fuchsia-100" },
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
 * What: renders the structure tree component and wires its props into the surrounding UI.
 *
 * Why: suggestion UI and state flows need consistent presentation and mutation behavior.
 * Called when: used by SuggestionVisual when that path needs this behavior.
 */
export function StructureTree({ nodes }: { nodes: StructureNode[] }) {
  return (
    <ol className="grid gap-2.5">
      {nodes.map((node) => (
        <li
          key={node.id}
          className="rounded-lg border border-[#dedbe9] bg-white/75 px-4 py-3"
        >
          <p className="text-sm font-semibold text-[#272631]">{node.label}</p>
          {node.detail ? (
            <p className="mt-1 text-sm leading-5 text-[#686577]">{node.detail}</p>
          ) : null}
          {node.children?.length ? (
            <div className="mt-3 border-l-2 border-brand-200 pl-3">
              <StructureTree nodes={node.children} />
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * What: renders the suggestion visual component and wires its props into the surrounding UI.
 *
 * Why: suggestion UI and state flows need consistent presentation and mutation behavior.
 * Called when: used by WorkspacePinCard and SuggestionDockDetail when that path needs this behavior.
 */
export function SuggestionVisual({ item }: { item: SuggestionItem }) {
  if (isStructureSuggestion(item)) {
    return <StructureTree nodes={item.nodes} />;
  }

  if (isMindMapSuggestion(item)) {
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
