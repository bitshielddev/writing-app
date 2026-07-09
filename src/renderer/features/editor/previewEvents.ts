export type PreviewResolution = {
  suggestionId: string;
  outcome: "accepted" | "cancelled";
};

const listeners = new Set<(resolution: PreviewResolution) => void>();

export function emitPreviewResolution(resolution: PreviewResolution) {
  listeners.forEach((listener) => listener(resolution));
}

export function subscribeToPreviewResolutions(
  listener: (resolution: PreviewResolution) => void,
) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
