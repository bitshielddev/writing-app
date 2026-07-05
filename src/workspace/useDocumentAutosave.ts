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
) {
  const [status, setStatus] = useState<DocumentSaveStatus>("idle");
  const [error, setError] = useState<string>();
  const documentIdRef = useRef("default-document");
  const revisionRef = useRef(0);
  const initializedRef = useRef(false);
  const readyRef = useRef(ready);
  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);

  const initialize = useCallback((document: DocumentSnapshot) => {
    documentIdRef.current = document.id;
    revisionRef.current = document.revision;
    initializedRef.current = true;
    setStatus("idle");
    setError(undefined);
  }, []);

  const enqueueSave = useCallback(() => {
    if (!readyRef.current || !initializedRef.current) return;

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

    queueRef.current = queueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (mountedRef.current) {
          setStatus("saving");
          setError(undefined);
        }
        const document = await desktop.saveDocument({
          documentId: documentIdRef.current,
          blocks,
          markdown,
          expectedRevision: revisionRef.current,
        });
        revisionRef.current = document.revision;
        if (mountedRef.current) setStatus("idle");
      })
      .catch((cause: unknown) => {
        if (mountedRef.current) {
          setStatus("failed");
          setError(message(cause));
        }
        console.error("Document save failed", cause);
      });
  }, [desktop, editor]);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    enqueueSave();
  }, [enqueueSave]);

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
      revisionRef.current = Math.max(
        revisionRef.current,
        event.document.revision,
      );
    }
  }, []);

  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      flushRef.current();
      mountedRef.current = false;
    };
  }, []);

  return { handleChange, flush, status, error, initialize, onDesktopEvent };
}
