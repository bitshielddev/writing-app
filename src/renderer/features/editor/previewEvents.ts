export type PreviewResolution = {
  suggestionId: string;
  outcome: "accepted" | "cancelled";
};

const listeners = new Set<(resolution: PreviewResolution) => void>();

/**
 * What: emits preview resolution to subscribers or the host runtime.
 *
 * Why: editor code needs a stable adapter around BlockNote and preview-specific behavior.
 * Called when: used by schema, resolve, App and useWorkspaceController when that path needs this behavior.
 */
export function emitPreviewResolution(resolution: PreviewResolution) {
  listeners.forEach((listener) => listener(resolution));
}

/**
 * What: subscribes to to preview resolutions and returns the cleanup path.
 *
 * Why: editor code needs a stable adapter around BlockNote and preview-specific behavior.
 * Called when: used by usePreviewController when that path needs this behavior.
 */
export function subscribeToPreviewResolutions(
  listener: (resolution: PreviewResolution) => void,
) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
