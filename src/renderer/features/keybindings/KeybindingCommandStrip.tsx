import { formatStroke } from "./defaultKeymap";
import type { CommandStripState } from "./useKeybindingController";

type KeybindingCommandStripProps = {
  state?: CommandStripState;
};

function Keycap({ children }: { children: string }) {
  return (
    <kbd className="inline-flex min-h-6 min-w-6 items-center justify-center rounded border border-white/20 bg-white/10 px-1.5 font-mono text-[0.7rem] font-bold text-white shadow-sm">
      {children}
    </kbd>
  );
}

export function KeybindingCommandStrip({
  state,
}: KeybindingCommandStripProps) {
  if (!state) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-5 left-1/2 z-[70] max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-xl bg-[#252431]/95 px-3.5 py-2.5 text-white shadow-2xl backdrop-blur"
    >
      {state.kind === "message" ? (
        <p className="text-sm font-semibold whitespace-nowrap">{state.message}</p>
      ) : (
        <div className="flex max-w-[56rem] flex-wrap items-center justify-center gap-x-3 gap-y-2">
          <span className="flex items-center gap-1" aria-label="Pending shortcut">
            <Keycap>Ctrl</Keycap>
            <span aria-hidden="true">+</span>
            <Keycap>;</Keycap>
            {state.sequence.map((stroke, index) => (
              <Keycap key={`${stroke}-${index}`}>{formatStroke(stroke)}</Keycap>
            ))}
          </span>
          <span className="hidden h-5 w-px bg-white/20 sm:block" aria-hidden="true" />
          <span className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5">
            {state.continuations.map(({ stroke, label }) => (
              <span key={stroke} className="inline-flex items-center gap-1.5 text-xs">
                <Keycap>{stroke}</Keycap>
                <span className="text-white/80">{label}</span>
              </span>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}
