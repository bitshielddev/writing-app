import {
  Archive,
  BookOpen,
  Clock3,
  FileText,
  FolderClosed,
  HelpCircle,
  Plus,
  Settings2,
  Sparkles,
  Upload,
  type LucideIcon,
} from "lucide-react";

type NavigationItem = {
  icon: LucideIcon;
  label: string;
  active?: boolean;
};

const navigationItems: NavigationItem[] = [
  { icon: BookOpen, label: "Library" },
  { icon: Clock3, label: "Recent", active: true },
  { icon: FileText, label: "Templates" },
  { icon: FolderClosed, label: "Collections" },
  { icon: Settings2, label: "Settings" },
];

const footerItems: NavigationItem[] = [
  { icon: HelpCircle, label: "Help" },
  { icon: Archive, label: "Archive" },
];

const sources = [
  { label: "Market_Trends_2024.pdf", tone: "text-amber-700" },
  { label: "Internal_Product_Vision.docx", tone: "text-brand-600" },
];

function NavigationButton({ active, icon: Icon, label }: NavigationItem) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      className={`flex min-h-11 w-full items-center gap-3.5 rounded-md px-3.5 text-left text-[0.95rem] font-medium transition-colors ${
        active
          ? "bg-[#e8e7f1] font-bold text-brand-700"
          : "text-[#5d5b6d] hover:bg-[#eceaf4] hover:text-brand-700"
      }`}
    >
      <Icon className="size-5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

export function Sidebar() {
  return (
    <aside
      aria-label="Project navigation"
      className="h-full min-h-0 overflow-y-auto border-r border-[#d7d4e8] bg-[#f4f2fd]"
    >
      <div className="flex min-h-full flex-col gap-5 px-5 py-6 2xl:px-6 2xl:py-8">
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-600 text-white shadow-sm shadow-brand-500/20">
            <Sparkles className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[1.7rem] font-extrabold leading-none tracking-[-0.04em] text-brand-700">
              ScribeAI
            </p>
            <p className="mt-1 truncate text-[0.65rem] font-bold tracking-[0.12em] text-[#686577] uppercase">
              AI-assisted drafts
            </p>
          </div>
        </div>

        <button
          type="button"
          className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-brand-600 px-4 text-sm font-semibold text-white shadow-lg shadow-brand-600/15 transition-colors hover:bg-brand-700"
        >
          <Plus className="size-5" aria-hidden="true" />
          <span>New Document</span>
        </button>

        <nav aria-label="Main sections" className="grid gap-1.5">
          {navigationItems.map((item) => (
            <NavigationButton key={item.label} {...item} />
          ))}
        </nav>

        <section aria-label="AI research context" className="mt-auto pt-4">
          <h2 className="text-[0.65rem] font-extrabold tracking-[0.12em] text-[#686577] uppercase">
            AI research context
          </h2>
          <div className="mt-3 grid gap-2">
            {sources.map((source) => (
              <button
                key={source.label}
                type="button"
                className="flex min-h-10 items-center gap-2.5 rounded-md border border-transparent bg-white/55 px-3 text-left text-xs text-[#393844] hover:border-[#d7d4e8] hover:bg-white"
              >
                <FileText className={`size-4 shrink-0 ${source.tone}`} aria-hidden="true" />
                <span className="min-w-0 truncate">{source.label}</span>
              </button>
            ))}
            <button
              type="button"
              className="flex min-h-10 items-center gap-2.5 rounded-md px-3 text-left text-xs font-semibold text-[#686577] hover:bg-white/65 hover:text-brand-700"
            >
              <Upload className="size-4" aria-hidden="true" />
              <span>Upload Sources</span>
            </button>
          </div>
        </section>

        <nav aria-label="Secondary sections" className="grid gap-1 border-t border-[#d7d4e8] pt-4">
          {footerItems.map((item) => (
            <NavigationButton key={item.label} {...item} />
          ))}
        </nav>
      </div>
    </aside>
  );
}
