import {
  Copy,
  ListTree,
  PlusCircle,
  Quote,
  Sparkles,
  Zap,
  type LucideIcon,
} from "lucide-react";

type ContextTab = {
  icon: LucideIcon;
  label: string;
  active?: boolean;
};

const tabs: ContextTab[] = [
  { icon: Zap, label: "AI Snippets", active: true },
  { icon: Quote, label: "Citations" },
  { icon: ListTree, label: "Outline" },
];

function SnippetActions({ label }: { label: string }) {
  return (
    <div className="mt-4 flex justify-end gap-1" aria-label={`${label} actions`}>
      <button
        type="button"
        aria-label={`Copy ${label.toLowerCase()}`}
        className="grid size-8 place-items-center rounded-md text-[#aaa6bd] hover:bg-brand-100 hover:text-brand-700"
      >
        <Copy className="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={`Insert ${label.toLowerCase()}`}
        className="grid size-8 place-items-center rounded-md text-[#aaa6bd] hover:bg-brand-100 hover:text-brand-700"
      >
        <PlusCircle className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export function ContextGutter() {
  return (
    <aside
      aria-label="AI context gutter"
      className="h-full min-h-0 overflow-y-auto border-l border-[#d7d4e8] bg-[#f4f2fd]"
    >
      <div className="px-5 py-6 2xl:px-7 2xl:py-7">
        <header>
          <h2 className="text-lg font-extrabold text-[#1a1b22]">Context Gutter</h2>
          <p className="mt-1 text-[0.65rem] font-extrabold tracking-[0.12em] text-[#686577] uppercase">
            AI suggestions
          </p>
        </header>

        <label className="relative mt-7 block">
          <span className="sr-only">Steer the AI context</span>
          <input
            type="text"
            placeholder="Steer the AI context..."
            className="min-h-11 w-full rounded-md border border-[#d7d4e8] bg-white/45 px-3.5 pr-11 text-sm text-[#1a1b22] placeholder:font-medium placeholder:text-[#a8a4bb] focus:border-brand-400"
          />
          <Sparkles
            className="pointer-events-none absolute top-1/2 right-3.5 size-5 -translate-y-1/2 text-[#aaa6bd]"
            aria-hidden="true"
          />
        </label>
        <p className="mt-2 text-[0.7rem] font-medium text-[#9591a8]">
          Guiding snippets for the current block
        </p>

        <div
          role="tablist"
          aria-label="Suggestion type"
          className="mt-7 grid grid-cols-3 gap-1 rounded-md bg-[#dfdde9] p-1"
        >
          {tabs.map(({ icon: Icon, label, active }) => (
            <button
              key={label}
              type="button"
              role="tab"
              aria-selected={active ?? false}
              className={`flex min-h-12 min-w-0 items-center justify-center gap-1 rounded px-1 text-[0.7rem] font-bold 2xl:text-xs ${
                active
                  ? "bg-brand-300 text-brand-800"
                  : "text-[#686577] hover:bg-white/45 hover:text-brand-700"
              }`}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{label}</span>
            </button>
          ))}
        </div>

        <section aria-label="Contextual suggestions" className="mt-7 grid gap-4">
          <article className="relative overflow-hidden rounded-lg border border-transparent bg-white/75 px-4 py-4 shadow-sm shadow-slate-900/5 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-brand-600">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex min-h-6 items-center rounded-sm bg-brand-100 px-2 text-[0.65rem] font-extrabold text-brand-700">
                Based on Internal Vision
              </span>
              <span className="inline-flex rounded-full border border-[#d7d4e8] bg-[#f1effa] p-0.5">
                <button
                  type="button"
                  aria-label="Show snippet version 1"
                  className="min-h-6 min-w-7 rounded-full bg-white text-[0.65rem] font-bold text-[#393844]"
                >
                  V1
                </button>
                <button
                  type="button"
                  aria-label="Show snippet version 2"
                  className="min-h-6 min-w-7 rounded-full text-[0.65rem] font-bold text-[#686577]"
                >
                  V2
                </button>
              </span>
            </div>
            <h3 className="mt-4 text-sm font-semibold text-[#1a1b22]">
              Human-centric design in AI tools
            </h3>
            <p className="mt-2 text-sm leading-6 text-[#393844]">
              Human-centric design in AI tools requires that the interface retreats when not needed,
              offering suggestions only when contextually relevant to the current paragraph block.
            </p>
            <SnippetActions label="Snippet" />
          </article>

          <article className="relative overflow-hidden rounded-lg border border-transparent bg-white/75 px-4 py-4 shadow-sm shadow-slate-900/5 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-brand-600">
            <span className="inline-flex min-h-6 items-center rounded-sm bg-brand-100 px-2 text-[0.65rem] font-extrabold text-brand-700">
              Actionable Terminology
            </span>
            <ul className="mt-3 grid list-disc gap-1.5 pl-5 text-sm leading-5 text-[#393844] marker:text-[#aaa6bd]">
              <li>Cognitive Partnership</li>
              <li>Frictionless Augmentation</li>
              <li>Contextual Relevance</li>
              <li>Opaque Oracles</li>
            </ul>
            <SnippetActions label="Terminology" />
          </article>

          <div
            role="status"
            className="grid min-h-28 place-items-center rounded-lg border border-dashed border-[#c9c5dc] px-5 py-5 text-center text-[#8f8a9f]"
          >
            <div>
              <Sparkles className="mx-auto size-7" aria-hidden="true" />
              <p className="mx-auto mt-2 max-w-48 text-xs font-medium leading-5">
                Write more to generate fresh contextual snippets...
              </p>
            </div>
          </div>
        </section>
      </div>
    </aside>
  );
}
