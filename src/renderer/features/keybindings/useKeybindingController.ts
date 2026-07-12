import { useCallback, useEffect, useMemo, useState } from "react";

import {
  COMMANDS_BY_ID,
  type AppCommandId,
  type CommandHandlers,
  type CommandResult,
  type KeyStroke,
} from "./commands";
import { DEFAULT_KEYMAP, formatStroke } from "./defaultKeymap";
import { matchSequence } from "./sequenceMatcher";

const SEQUENCE_TIMEOUT_MS = 2_000;
const MESSAGE_TIMEOUT_MS = 3_000;

export type CommandStripState =
  | {
      kind: "pending";
      sequence: KeyStroke[];
      continuations: { stroke: KeyStroke; label: string }[];
    }
  | { kind: "message"; message: string };

type KeybindingControllerOptions = {
  disabled?: boolean;
  handlers: CommandHandlers;
};

function executeCommand(
  handlers: CommandHandlers,
  commandId: AppCommandId,
): CommandResult {
  switch (commandId) {
    case "help.open": return handlers["help.open"]();
    case "region.navigation.focus": return handlers["region.navigation.focus"]();
    case "region.partner.focus": return handlers["region.partner.focus"]();
    case "region.editor.focus": return handlers["region.editor.focus"]();
    case "region.navigation.toggle": return handlers["region.navigation.toggle"]();
    case "region.partner.toggle": return handlers["region.partner.toggle"]();
    case "suggestion.next": return handlers["suggestion.next"]();
    case "suggestion.previous": return handlers["suggestion.previous"]();
    case "suggestion.open": return handlers["suggestion.open"]();
    case "suggestion.back": return handlers["suggestion.back"]();
    case "suggestion.pin.toggle": return handlers["suggestion.pin.toggle"]();
    case "suggestion.preview": return handlers["suggestion.preview"]();
    case "suggestion.accept": return handlers["suggestion.accept"]();
    case "suggestion.dismiss": return handlers["suggestion.dismiss"]();
  }
}

/**
 * What: returns whether the supplied value matches leader.
 *
 * Why: keyboard workflows need shared sequence and command behavior across the UI.
 * Called when: used by handleKeyDown when that path needs this behavior.
 */
function isLeader(event: KeyboardEvent) {
  return (
    event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.repeat &&
    (event.key === ";" || event.code === "Semicolon")
  );
}

/**
 * What: performs the normalize stroke step for this file's workflow.
 *
 * Why: keyboard workflows need shared sequence and command behavior across the UI.
 * Called when: used by handleKeyDown when that path needs this behavior.
 */
function normalizeStroke(event: KeyboardEvent): KeyStroke | undefined {
  if (event.ctrlKey || event.altKey || event.metaKey || event.repeat) {
    return undefined;
  }
  if (event.key === "Enter") return "Enter";
  if (event.key.length === 1) return event.key;
  return undefined;
}

/**
 * What: coordinates keybinding controller state, side effects, and callbacks for the renderer workflow.
 *
 * Why: keyboard workflows need shared sequence and command behavior across the UI.
 * Called when: used by useWorkspaceKeybindings and Harness when that path needs this behavior.
 */
export function useKeybindingController({
  disabled = false,
  handlers,
}: KeybindingControllerOptions) {
  const [pending, setPending] = useState(false);
  const [sequence, setSequence] = useState<KeyStroke[]>([]);
  const [message, setMessage] = useState<string>();

  const cancelSequence = useCallback(() => {
    setPending(false);
    setSequence([]);
  }, []);

  const showMessage = useCallback((nextMessage: string) => {
    setMessage(nextMessage);
  }, []);

  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(cancelSequence, SEQUENCE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [cancelSequence, pending, sequence]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(
      () => setMessage(undefined),
      MESSAGE_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    /**
     * What: handles key down and routes the effect to the owning workflow.
     *
     * Why: keyboard workflows need shared sequence and command behavior across the UI.
     * Called when: used by useKeybindingController when that path needs this behavior.
     */
    const handleKeyDown = (event: KeyboardEvent) => {
      if (disabled) return;

      if (isLeader(event)) {
        event.preventDefault();
        event.stopPropagation();
        setMessage(undefined);
        setPending(true);
        setSequence([]);
        return;
      }

      if (!pending) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelSequence();
        return;
      }

      const stroke = normalizeStroke(event);
      if (!stroke) {
        cancelSequence();
        return;
      }

      const nextSequence = [...sequence, stroke];
      const match = matchSequence(nextSequence, DEFAULT_KEYMAP);
      if (match.status === "invalid") {
        cancelSequence();
        showMessage("Unknown shortcut");
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (match.status === "partial") {
        setSequence(nextSequence);
        return;
      }

      cancelSequence();
      const result = executeCommand(handlers, match.commandId);
      if (result.status === "unavailable") showMessage(result.message);
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [
    cancelSequence,
    disabled,
    handlers,
    pending,
    sequence,
    showMessage,
  ]);

  const stripState = useMemo<CommandStripState | undefined>(() => {
    if (pending) {
      const match = matchSequence(sequence, DEFAULT_KEYMAP);
      const continuations =
        match.status === "partial"
          ? match.continuations.map(({ stroke, commandIds }) => ({
              stroke: formatStroke(stroke),
              label:
                commandIds.length === 1
                  ? COMMANDS_BY_ID[commandIds[0]].label
                  : "Continue sequence",
            }))
          : [];
      return { kind: "pending", sequence, continuations };
    }
    return message ? { kind: "message", message } : undefined;
  }, [message, pending, sequence]);

  return { stripState, cancelSequence, showMessage };
}
