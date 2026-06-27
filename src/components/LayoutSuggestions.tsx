import { GitBranch, List, Rows3, type LucideIcon } from "lucide-react";

type LayoutSuggestion = {
  icon: LucideIcon;
  title: string;
  tone: string;
};

const suggestions: LayoutSuggestion[] = [
  {
    icon: Rows3,
    title: "The Problem/Solution Framework",
    tone: "text-brand-600",
  },
  {
    icon: GitBranch,
    title: "The Narrative Journey",
    tone: "text-indigo-500",
  },
  {
    icon: List,
    title: "Data-Driven Argument",
    tone: "text-amber-700",
  },
];

export function LayoutSuggestions() {
  return (
    <section
      aria-labelledby="layout-suggestions-title"
      className="shrink-0 overflow-hidden border-b border-[#d7d4e8] bg-[#fbf8ff] px-4 py-5 lg:px-7 lg:py-6"
    >
      <h2
        id="layout-suggestions-title"
        className="text-[0.65rem] font-extrabold tracking-[0.12em] text-[#686577] uppercase"
      >
        Suggested layouts &amp; outlines
      </h2>
      <div className="mt-4 grid auto-cols-[minmax(15rem,18rem)] grid-flow-col gap-3 overflow-x-auto pb-1 lg:gap-4">
        {suggestions.map(({ icon: Icon, title, tone }) => (
          <button
            key={title}
            type="button"
            className={`grid min-h-28 grid-cols-[1.25rem_1fr] grid-rows-[auto_repeat(3,0.4rem)] items-start gap-x-3 gap-y-2 rounded-lg border border-[#d7d4e8] bg-white/60 px-4 py-4 text-left transition-colors hover:border-brand-300 hover:bg-white ${tone}`}
          >
            <Icon className="mt-0.5 size-5" aria-hidden="true" />
            <span className="text-sm font-semibold leading-snug">{title}</span>
            <span className="col-start-2 h-1.5 w-full rounded-full bg-[#dedce8]" />
            <span className="col-start-2 h-1.5 w-3/4 rounded-full bg-[#dedce8]" />
            <span className="col-start-2 h-1.5 w-5/6 rounded-full bg-[#dedce8]" />
          </button>
        ))}
      </div>
    </section>
  );
}
