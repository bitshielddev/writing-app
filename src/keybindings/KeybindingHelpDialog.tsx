import { Keyboard, X } from "lucide-react";
import { useMemo, useRef } from "react";

import { useModalFocus } from "../components/useModalFocus";
import { COMMAND_CATALOG, type CommandDefinition } from "./commands";
import { DEFAULT_KEYMAP, formatSequence } from "./defaultKeymap";

type KeybindingHelpDialogProps = {
  open: boolean;
  onClose: () => void;
};

const GROUPS: CommandDefinition["group"][] = [
  "Workspace",
  "Suggestions",
  "Help",
];

export function KeybindingHelpDialog({
  open,
  onClose,
}: KeybindingHelpDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const groupedCommands = useMemo(
    () =>
      GROUPS.map((group) => ({
        group,
        commands: COMMAND_CATALOG.filter((command) => command.group === group),
      })),
    [],
  );

  useModalFocus({
    containerRef: dialogRef,
    initialFocusRef: closeButtonRef,
    open,
    onClose,
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center p-4 sm:p-8">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[#13141c]/55 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="keybinding-help-title"
        aria-describedby="keybinding-help-description"
        className="relative flex max-h-[min(48rem,calc(100dvh-2rem))] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[#d7d4e8] bg-[#fbfaff] shadow-2xl"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-[#dedbe9] px-5 py-4 sm:px-7 sm:py-5">
          <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-lg bg-brand-600 text-white">
            <Keyboard className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="keybinding-help-title"
              className="text-xl font-extrabold tracking-[-0.025em] text-[#1a1b22]"
            >
              Keyboard shortcuts
            </h2>
            <p
              id="keybinding-help-description"
              className="mt-1 text-sm leading-5 text-[#686577]"
            >
              Start every shortcut with Ctrl+;. The sequence expires after two
              seconds, and ordinary typing remains unchanged.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close keyboard shortcuts"
            className="grid size-9 shrink-0 place-items-center rounded-md text-[#5d5b6d] hover:bg-[#e8e7f1] hover:text-brand-700"
            onClick={onClose}
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
          <div className="grid gap-7">
            {groupedCommands.map(({ group, commands }) => (
              <section key={group} aria-labelledby={`shortcut-group-${group}`}>
                <h3
                  id={`shortcut-group-${group}`}
                  className="text-xs font-extrabold tracking-[0.1em] text-brand-700 uppercase"
                >
                  {group}
                </h3>
                <dl className="mt-3 divide-y divide-[#e5e2ef] rounded-xl border border-[#dedbe9] bg-white/75 px-4">
                  {commands.map((command) => (
                    <div
                      key={command.id}
                      className="grid gap-2 py-3.5 sm:grid-cols-[minmax(13rem,1fr)_auto] sm:items-center sm:gap-5"
                    >
                      <div>
                        <dt className="text-sm font-bold text-[#292a34]">
                          {command.label}
                        </dt>
                        <dd className="mt-0.5 text-xs leading-5 text-[#777386]">
                          {command.description}
                        </dd>
                      </div>
                      <dd className="flex flex-wrap items-center gap-1">
                        {formatSequence(DEFAULT_KEYMAP[command.id]).map(
                          (key, index) => (
                            <kbd
                              key={`${key}-${index}`}
                              className="inline-flex min-h-7 min-w-7 items-center justify-center rounded-md border border-[#c9c5dc] bg-[#f2f0f8] px-2 font-mono text-xs font-bold text-[#393844] shadow-sm"
                            >
                              {key}
                            </kbd>
                          ),
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
