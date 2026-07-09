export const PERFORMANCE_MARKS = {
  bootstrap: "scribe:bootstrap",
  reactMounted: "scribe:react-mounted",
  hydrationComplete: "scribe:hydration-complete",
  editorReady: "scribe:editor-ready",
} as const;

export function markPerformance(name: (typeof PERFORMANCE_MARKS)[keyof typeof PERFORMANCE_MARKS]) {
  if (typeof performance.mark === "function") {
    performance.mark(name);
  }
}
