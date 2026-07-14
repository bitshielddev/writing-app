import { Keyboard } from "lucide-react";
import { useMemo } from "react";

import { ModalDialog } from "../../ui/ModalDialog";
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

/**
 * What: renders the keybinding help dialog component and wires its props into the surrounding UI.
 *
 * Why: keyboard workflows need shared sequence and command behavior across the UI.
 * Called when: used by KeybindingHelpBoundary and Harness when that path needs this behavior.
 */
export function KeybindingHelpDialog({
  open,
  onClose,
}: KeybindingHelpDialogProps) {
  const groupedCommands = useMemo(
    () =>
      GROUPS.map((group) => ({
        group,
        commands: COMMAND_CATALOG.filter((command) => command.group === group),
      })),
    [],
  );

  return (
    <ModalDialog open={open} onClose={onClose} titleId="keybinding-help-title"
      descriptionId="keybinding-help-description" title="Keyboard shortcuts"
      description="Start every shortcut with Ctrl+;. The sequence expires after two seconds, and ordinary typing remains unchanged."
      icon={Keyboard} closeLabel="Close keyboard shortcuts">
          <div className="grid gap-7">
            {groupedCommands.map(({ group, commands }) => (
              <section key={group} aria-labelledby={`shortcut-group-${group}`}>
                <h3
                  id={`shortcut-group-${group}`}
                  className="text-xs font-extrabold tracking-[0.1em] text-brand-700 uppercase"
                >
                  {group}
                </h3>
                <dl className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface-raised px-4">
                  {commands.map((command) => (
                    <div
                      key={command.id}
                      className="grid gap-2 py-3.5 sm:grid-cols-[minmax(13rem,1fr)_auto] sm:items-center sm:gap-5"
                    >
                      <div>
                        <dt className="text-sm font-bold text-foreground">
                          {command.label}
                        </dt>
                        <dd className="mt-0.5 text-xs leading-5 text-muted-foreground">
                          {command.description}
                        </dd>
                      </div>
                      <dd className="flex flex-wrap items-center gap-1">
                        {formatSequence(DEFAULT_KEYMAP[command.id]).map(
                          (key, index) => (
                            <kbd
                              key={`${key}-${index}`}
                              className="inline-flex min-h-7 min-w-7 items-center justify-center rounded-md border border-border bg-muted px-2 font-mono text-xs font-bold text-foreground shadow-sm"
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
    </ModalDialog>
  );
}
