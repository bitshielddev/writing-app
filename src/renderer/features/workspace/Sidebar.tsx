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
import type { Ref } from "react";

import type { SourceSnapshot, WorkspaceCatalog } from "../../../contracts/desktop-bridge";

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

type SidebarProps = {
  sources?: SourceSnapshot[];
  catalog?: WorkspaceCatalog;
  switching?: boolean;
  switchError?: string;
  regionRef?: Ref<HTMLElement>;
  onOpenKeybindingHelp?: () => void;
  onUploadSource?: () => void;
  onCreateDocument?: () => void;
  onSelectDocument?: (projectId: string, documentId: string) => void;
  onRetrySwitch?: () => void;
  onDiscardAndSwitch?: () => void;
  onCreateProject?: () => void;
  onRenameProject?: (projectId: string, name: string) => void;
  onDeleteProject?: (projectId: string) => void;
  onRenameDocument?: (projectId: string, documentId: string, title: string) => void;
  onDeleteDocument?: (projectId: string, documentId: string) => void;
};

/**
 * What: renders the navigation button component and wires its props into the surrounding UI.
 *
 * Why: workspace views and controllers need one source for selection, layout, and persistence behavior.
 * Called when: used by Sidebar when that path needs this behavior.
 */
function NavigationButton({
  active,
  icon: Icon,
  label,
  onClick,
}: NavigationItem & { onClick?: () => void }) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      className={`flex min-h-11 w-full items-center gap-3.5 rounded-md px-3.5 text-left text-[0.95rem] font-medium transition-colors ${
        active
          ? "bg-[#e8e7f1] font-bold text-brand-700"
          : "text-[#5d5b6d] hover:bg-[#eceaf4] hover:text-brand-700"
      }`}
      onClick={onClick}
    >
      <Icon className="size-5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

/**
 * What: renders the sidebar component and wires its props into the surrounding UI.
 *
 * Why: workspace views and controllers need one source for selection, layout, and persistence behavior.
 * Called when: used by App when that path needs this behavior.
 */
export function Sidebar({
  sources = [],
  catalog,
  switching,
  switchError,
  regionRef,
  onOpenKeybindingHelp,
  onUploadSource,
  onCreateDocument,
  onSelectDocument,
  onRetrySwitch,
  onDiscardAndSwitch,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
  onRenameDocument,
  onDeleteDocument,
}: SidebarProps) {
  return (
    <aside
      ref={regionRef}
      tabIndex={regionRef ? -1 : undefined}
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
          disabled={switching}
          onClick={onCreateDocument}
          className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-brand-600 px-4 text-sm font-semibold text-white shadow-lg shadow-brand-600/15 transition-colors hover:bg-brand-700"
        >
          <Plus className="size-5" aria-hidden="true" />
          <span>New Document</span>
        </button>

        {catalog ? (
          <nav aria-label="Projects and documents" className="grid gap-3">
            <button type="button" className="px-2 text-left text-xs font-semibold text-brand-700"
              disabled={switching} onClick={onCreateProject}>+ New project</button>
            {catalog.projects.map((project) => (
              <section key={project.id} aria-label={project.name}>
                <div className="flex items-center gap-1 px-2">
                  <h2 className="min-w-0 flex-1 truncate text-xs font-bold text-[#686577]">{project.name}</h2>
                  <button type="button" aria-label={`Rename ${project.name}`} onClick={() => onRenameProject?.(project.id, project.name)}>✎</button>
                  <button type="button" aria-label={`Delete ${project.name}`} onClick={() => onDeleteProject?.(project.id)}>×</button>
                </div>
                <div className="mt-1 grid gap-1">
                  {catalog.documents.filter((document) => document.projectId === project.id).map((document) => {
                    const selected = catalog.selection.documentId === document.id;
                    return <div key={document.id} className="flex items-center gap-1">
                      <button type="button" aria-current={selected ? "page" : undefined} disabled={switching}
                        className={`min-h-9 min-w-0 flex-1 truncate rounded-md px-3 text-left text-sm ${selected ? "bg-[#e8e7f1] font-bold text-brand-700" : "text-[#5d5b6d] hover:bg-white/70"}`}
                        onClick={() => onSelectDocument?.(project.id, document.id)}>{document.title}</button>
                      <button type="button" aria-label={`Rename ${document.title}`} onClick={() => onRenameDocument?.(project.id, document.id, document.title)}>✎</button>
                      <button type="button" aria-label={`Delete ${document.title}`} onClick={() => onDeleteDocument?.(project.id, document.id)}>×</button>
                    </div>;
                  })}
                </div>
              </section>
            ))}
            {switchError ? <div role="alert" className="px-2 text-xs text-red-700">
              <p>{switchError}</p>
              <div className="mt-2 flex gap-2">
                <button type="button" className="underline" onClick={onRetrySwitch}>Retry</button>
                <button type="button" className="underline" onClick={onDiscardAndSwitch}>Discard local changes</button>
              </div>
            </div> : null}
          </nav>
        ) : null}

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
            {sources.map((source, index) => (
              <button
                key={source.id}
                type="button"
                className="flex min-h-10 items-center gap-2.5 rounded-md border border-transparent bg-white/55 px-3 text-left text-xs text-[#393844] hover:border-[#d7d4e8] hover:bg-white"
              >
                <FileText
                  className={`size-4 shrink-0 ${index % 2 ? "text-brand-600" : "text-amber-700"}`}
                  aria-hidden="true"
                />
                <span className="min-w-0 truncate">{source.title}</span>
              </button>
            ))}
            <button
              type="button"
              className="flex min-h-10 items-center gap-2.5 rounded-md px-3 text-left text-xs font-semibold text-[#686577] hover:bg-white/65 hover:text-brand-700"
              onClick={onUploadSource}
            >
              <Upload className="size-4" aria-hidden="true" />
              <span>Upload Sources</span>
            </button>
          </div>
        </section>

        <nav aria-label="Secondary sections" className="grid gap-1 border-t border-[#d7d4e8] pt-4">
          {footerItems.map((item) => (
            <NavigationButton
              key={item.label}
              {...item}
              onClick={item.label === "Help" ? onOpenKeybindingHelp : undefined}
            />
          ))}
        </nav>
      </div>
    </aside>
  );
}
