type RuntimeRequiredProps = {
  message: string;
};

/**
 * What: renders the runtime required component and wires its props into the surrounding UI.
 *
 * Why: callers need this behavior in one named place instead of duplicating it.
 * Called when: used by main when that path needs this behavior.
 */
export function RuntimeRequired({ message }: RuntimeRequiredProps) {
  return (
    <main className="grid min-h-dvh place-items-center bg-panel p-8">
      <section className="max-w-lg rounded-2xl border border-border bg-surface-raised p-8 shadow-xl shadow-brand-900/5">
        <h1 className="text-2xl font-extrabold text-foreground">
          Electron desktop runtime required
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{message}</p>
      </section>
    </main>
  );
}
