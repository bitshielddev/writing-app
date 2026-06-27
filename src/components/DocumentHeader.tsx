import {
  EllipsisVertical,
  History,
  Menu,
  PanelRightOpen,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

type DocumentHeaderProps = {
  onOpenContext: () => void;
  onOpenNavigation: () => void;
};

type IconButtonProps = {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  responsiveOnly?: boolean;
};

function IconButton({
  icon: Icon,
  label,
  onClick,
  responsiveOnly = false,
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      className={`grid size-10 shrink-0 place-items-center rounded-md text-[#5d5b6d] transition-colors hover:bg-[#eeedf7] hover:text-brand-700 ${
        responsiveOnly ? "xl:hidden" : ""
      }`}
      onClick={onClick}
    >
      <Icon className="size-[1.3rem]" aria-hidden="true" />
    </button>
  );
}

const tabs = ["Drafts", "Review", "Published"];

export function DocumentHeader({
  onOpenContext,
  onOpenNavigation,
}: DocumentHeaderProps) {
  return (
    <header className="flex min-h-20 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#e8e5f2] bg-[#fbf8ff] px-4 py-3 lg:px-7 2xl:flex-nowrap 2xl:gap-x-6 2xl:py-0">
      <IconButton
        icon={Menu}
        label="Open project navigation"
        onClick={onOpenNavigation}
        responsiveOnly
      />

      <div className="flex min-w-0 items-center gap-2.5">
        <h1 className="truncate text-xl font-extrabold tracking-[-0.03em] text-brand-700 lg:text-2xl">
          Untitled Draft
        </h1>
        <span className="inline-flex min-h-6 shrink-0 items-center rounded-full bg-[#e8e7f1] px-2.5 text-[0.7rem] font-bold text-[#686577]">
          Draft
        </span>
      </div>

      <nav
        aria-label="Draft status"
        className="order-last flex h-11 w-full items-end gap-5 overflow-x-auto 2xl:order-none 2xl:h-full 2xl:w-auto 2xl:items-center"
      >
        {tabs.map((tab, index) => (
          <button
            key={tab}
            type="button"
            aria-current={index === 0 ? "page" : undefined}
            className={`h-full border-b-[3px] px-0.5 text-sm font-semibold ${
              index === 0
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-[#686577] hover:text-brand-700"
            }`}
          >
            {tab}
          </button>
        ))}
      </nav>

      <div aria-label="Document actions" className="ml-auto flex items-center gap-1.5">
        <IconButton icon={History} label="View history" />
        <IconButton icon={Sparkles} label="Generate ideas" />
        <button
          type="button"
          className="hidden min-h-10 items-center rounded-md border border-brand-600 px-3 text-sm font-semibold text-brand-600 hover:bg-brand-50 lg:inline-flex"
        >
          Export
        </button>
        <button
          type="button"
          className="hidden min-h-10 items-center rounded-md bg-brand-600 px-3.5 text-sm font-semibold text-white shadow-md shadow-brand-600/15 hover:bg-brand-700 lg:inline-flex"
        >
          Share
        </button>
        <IconButton icon={EllipsisVertical} label="More document options" />
        <IconButton
          icon={PanelRightOpen}
          label="Open AI context"
          onClick={onOpenContext}
          responsiveOnly
        />
      </div>
    </header>
  );
}
