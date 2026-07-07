import { useCallback, useEffect, useRef, useState } from "react";

import type { WritingEditor } from "../editor/schema";
import type { DesktopBridge, DesktopEvent, DocumentSnapshot } from "../shared/desktop";

export const DOCUMENT_AUTOSAVE_DELAY_MS = 650;

export type DocumentSaveStatus = "idle" | "saving" | "failed";

function message(error: unknown): string {
  return error instanceof Error ? error.message : "The document could not be saved";
}

export function useDocumentAutosave(
  desktop: DesktopBridge,
  editor: WritingEditor,
  ready: boolean,
  storageHealthy = true,
) {
  const [status, setStatus] = useState<DocumentSaveStatus>("idle");
  const [error, setError] = useState<string>();
  const projectIdRef = useRef("default-project");
  const documentIdRef = useRef("default-document");
  const revisionRef = useRef(0);
  const initializedRef = useRef(false);
  const readyRef = useRef(ready);
  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const failureRef = useRef<unknown>(undefined);
  const generationRef = useRef(0);

  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);

  const initialize = useCallback((document: DocumentSnapshot) => {
    generationRef.current += 1;
    projectIdRef.current = document.projectId;
    documentIdRef.current = document.id;
    revisionRef.current = document.revision;
    initializedRef.current = true;
    setStatus("idle");
    setError(undefined);
    failureRef.current = undefined;
  }, []);

  const enqueueSave = useCallback(() => {
    if (!readyRef.current || !initializedRef.current || !storageHealthy) return;

    let blocks: WritingEditor["document"];
    let markdown: string;
    try {
      blocks = editor.document.filter(
        (block) => block.type !== "suggestionPreview",
      );
      markdown = editor.blocksToMarkdownLossy(blocks);
    } catch (cause) {
      if (mountedRef.current) {
        setStatus("failed");
        setError(message(cause));
      }
      return;
    }

    const generation = generationRef.current;
    const projectId = projectIdRef.current;
    const documentId = documentIdRef.current;
    queueRef.current = queueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (generation !== generationRef.current) return;
        if (mountedRef.current && generation === generationRef.current) {
          setStatus("saving");
          setError(undefined);
        }
        if (generation === generationRef.current) failureRef.current = undefined;
        const document = await desktop.saveDocument({
          projectId,
          documentId,
          blocks,
          markdown,
          expectedRevision: revisionRef.current,
        });
        if (generation !== generationRef.current) return;
        revisionRef.current = document.revision;
        if (mountedRef.current) setStatus("idle");
      })
      .catch((cause: unknown) => {
        if (generation === generationRef.current) failureRef.current = cause;
        if (mountedRef.current && generation === generationRef.current) {
          setStatus("failed");
          setError(message(cause));
        }
        console.error("Document save failed", cause);
      });
  }, [desktop, editor, storageHealthy]);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    enqueueSave();
  }, [enqueueSave]);
  const flushForSwitch = useCallback(async () => {
    flush();
    await queueRef.current;
    if (failureRef.current) throw failureRef.current;
  }, [flush]);

  const handleChange = useCallback(() => {
    if (!readyRef.current || !initializedRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined;
      enqueueSave();
    }, DOCUMENT_AUTOSAVE_DELAY_MS);
  }, [enqueueSave]);

  const onDesktopEvent = useCallback((event: DesktopEvent) => {
    if (event.type === "document.saved") {
      if (event.document.id !== documentIdRef.current || event.document.projectId !== projectIdRef.current) return;
      revisionRef.current = Math.max(
        revisionRef.current,
        event.document.revision,
      );
    }
  }, []);

  const discard = useCallback(() => {
    generationRef.current += 1;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = undefined;
    failureRef.current = undefined;
    setStatus("idle");
    setError(undefined);
  }, []);

  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      void flushRef.current();
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (storageHealthy && failureRef.current) enqueueSave();
  }, [enqueueSave, storageHealthy]);

  return { handleChange, flush, flushForSwitch, discard, status, error, initialize, onDesktopEvent };
}
