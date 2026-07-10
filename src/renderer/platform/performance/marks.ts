export const PERFORMANCE_MARKS = {
  bootstrap: "scribe:bootstrap",
  reactMounted: "scribe:react-mounted",
  hydrationComplete: "scribe:hydration-complete",
  editorReady: "scribe:editor-ready",
} as const;

/**
 * What: performs the mark performance step for this file's workflow.
 *
 * Why: renderer platform adapters need to isolate Electron and browser runtime details.
 * Called when: used by DocumentEditor, useWorkspaceHydration, App and main when that path needs this behavior.
 */
export function markPerformance(name: (typeof PERFORMANCE_MARKS)[keyof typeof PERFORMANCE_MARKS]) {
  if (typeof performance.mark === "function") {
    performance.mark(name);
  }
}
