import { useCreateBlockNote } from "@blocknote/react";
import { useEffect, useMemo, useState } from "react";

import { EditorWorkspace } from "./components/EditorWorkspace";
import { ResponsiveDrawer } from "./components/ResponsiveDrawer";
import { Sidebar } from "./components/Sidebar";
import { SuggestionDock } from "./components/SuggestionDock";
import { getAcceptedDocumentBlocks } from "./editor/documentContext";
import { subscribeToPreviewResolutions } from "./editor/previewEvents";
import {
  writingSchema,
  type WritingPartialBlock,
} from "./editor/schema";
import { createAgentContextSource } from "./suggestions/contextSource";
import { useSuggestionInbox } from "./suggestions/inbox";
import { createMockSuggestionFeed } from "./suggestions/mockSuggestionFeed";
import { getInitialWorkspacePinSize } from "./suggestions/workspacePinLayout";
import type {
  ArtifactReference,
  SuggestionItem,
  TextSuggestion,
} from "./suggestions/types";

const initialContent: WritingPartialBlock[] = [
  {
    type: "heading",
    props: { level: 1 },
    content: "The Future of AI Collaboration",
  },
  {
    type: "paragraph",
    content:
      "The integration of artificial intelligence into creative workflows is no longer a speculative concept; it is an active paradigm shift. As we observe the maturation of language models, the focus is moving from mere automation to profound augmentation.",
  },
  {
    type: "paragraph",
    content:
      "Unlike early tools that acted as opaque oracles, the next generation of AI interfaces is designed for cognitive partnership. They exist in the gutters of our digital canvas, offering contextual relevance without disrupting the user's flow state.",
  },
  { type: "paragraph" },
];

const artifacts: ArtifactReference[] = [
  { id: "market-trends", title: "Market_Trends_2024.pdf", kind: "pdf" },
  {
    id: "product-vision",
    title: "Internal_Product_Vision.docx",
    kind: "document",
  },
];

function isTextSuggestion(item: SuggestionItem): item is TextSuggestion {
  return item.kind === "snippet" || item.kind === "fact" || item.kind === "term";
}

export default function App() {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [steeringFocusRequest, setSteeringFocusRequest] = useState(0);
  const editor = useCreateBlockNote({ schema: writingSchema, initialContent });
  const contextSource = useMemo(() => createAgentContextSource(artifacts), []);
  const feed = useMemo(
    () => createMockSuggestionFeed(contextSource),
    [contextSource],
  );
  const inbox = useSuggestionInbox(feed);
  const resolvePreview = inbox.previewResolved;
  const [lastActiveBlockId, setLastActiveBlockId] = useState(
    () => {
      try {
        return editor.getTextCursorPosition().block.id;
      } catch {
        return editor.document.at(-1)?.id;
      }
    },
  );

  useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 1280px)");
    const closeDrawersAtDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) {
        setNavigationOpen(false);
        setContextOpen(false);
      }
    };

    desktopQuery.addEventListener("change", closeDrawersAtDesktop);
    return () => desktopQuery.removeEventListener("change", closeDrawersAtDesktop);
  }, []);

  useEffect(() => {
    contextSource.updateDocument(getAcceptedDocumentBlocks(editor));
  }, [contextSource, editor]);

  useEffect(
    () =>
      subscribeToPreviewResolutions(({ suggestionId, outcome }) => {
        resolvePreview(suggestionId, outcome);
      }),
    [resolvePreview],
  );

  const openSteering = () => {
    inbox.back();
    if (!window.matchMedia("(min-width: 1280px)").matches) {
      setContextOpen(true);
    }
    setSteeringFocusRequest((request) => request + 1);
  };

  const handleEditorSelectionChange = () => {
    try {
      setLastActiveBlockId(editor.getTextCursorPosition().block.id);
    } catch {
      // The editor can briefly have no text cursor during block selection.
    }
  };

  const handleEditorChange = () => {
    contextSource.updateDocument(getAcceptedDocumentBlocks(editor));
  };

  const handlePreview = (item: SuggestionItem) => {
    if (inbox.activePreviewId || !isTextSuggestion(item)) {
      return;
    }

    const acceptedBlocks = editor.document.filter(
      (block) => block.type !== "suggestionPreview",
    );
    const referenceBlock =
      acceptedBlocks.find((block) => block.id === lastActiveBlockId) ??
      acceptedBlocks.at(-1);
    if (!referenceBlock) {
      return;
    }

    const preview = editor.insertBlocks(
      [
        {
          type: "suggestionPreview",
          props: {
            suggestionId: item.id,
            targetBlockId: referenceBlock.id,
          },
          content: item.insertText,
        },
      ],
      referenceBlock,
      "after",
    )[0];

    if (preview) {
      inbox.previewStarted(item.id);
      editor.setTextCursorPosition(preview.id, "end");
      window.requestAnimationFrame(() => {
        document
          .querySelector(
            `[data-content-type="suggestionPreview"][data-suggestion-id="${item.id}"]`,
          )
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    }
  };

  const handlePlaceOnWorkspace = (item: SuggestionItem) => {
    inbox.placeOnWorkspace(item.id, {
      x: 16,
      y: 16,
      ...getInitialWorkspacePinSize(item),
    });
  };

  const dock = (
    <SuggestionDock
      feed={feed}
      entries={inbox.entries}
      pinnedEntries={inbox.pinnedEntries}
      selectedEntry={inbox.selectedEntry}
      activePreviewId={inbox.activePreviewId}
      unreadCount={inbox.unreadCount}
      status={inbox.status}
      error={inbox.error}
      focusRequest={steeringFocusRequest}
      onSelect={inbox.select}
      onBack={inbox.back}
      onDismiss={inbox.dismiss}
      onPin={inbox.pin}
      onUnpin={inbox.unpin}
      onPlaceOnWorkspace={handlePlaceOnWorkspace}
      onPreview={handlePreview}
    />
  );

  const contextColumnClass = inbox.selectedEntry
    ? "xl:grid-cols-[248px_minmax(0,1fr)_clamp(30rem,38vw,40rem)] 2xl:grid-cols-[280px_minmax(0,1fr)_clamp(30rem,38vw,40rem)]"
    : "xl:grid-cols-[248px_minmax(0,1fr)_320px] 2xl:grid-cols-[280px_minmax(0,1fr)_360px]";

  return (
    <div className="app-background min-h-dvh p-0 xl:p-2 2xl:p-[18px]">
      <main
        aria-label="ScribeAI writing workspace"
        className={`grid h-dvh min-h-0 overflow-hidden bg-white xl:h-[calc(100dvh-1rem)] xl:rounded-3xl xl:border xl:border-[#bec0cb] xl:shadow-[0_22px_70px_rgb(0_0_0/28%)] 2xl:h-[calc(100dvh-36px)] 2xl:rounded-[2rem] ${contextColumnClass}`}
      >
        <div className="hidden min-h-0 xl:block">
          <Sidebar />
        </div>

        <EditorWorkspace
          editor={editor}
          workspacePins={inbox.workspacePins}
          onOpenNavigation={() => setNavigationOpen(true)}
          onOpenContext={() => setContextOpen(true)}
          onGenerateIdeas={openSteering}
          onEditorChange={handleEditorChange}
          onEditorSelectionChange={handleEditorSelectionChange}
          onWorkspacePinGeometryChange={inbox.updateWorkspaceGeometry}
          onRaiseWorkspacePin={inbox.raiseWorkspacePin}
          onReturnToPins={inbox.returnToPins}
        />

        <div className="hidden min-h-0 xl:block">
          {dock}
        </div>
      </main>

      <ResponsiveDrawer
        id="navigation-drawer"
        title="Project navigation"
        side="left"
        open={navigationOpen}
        onClose={() => setNavigationOpen(false)}
      >
        <Sidebar />
      </ResponsiveDrawer>

      <ResponsiveDrawer
        id="context-drawer"
        title="Writing partner"
        side="right"
        wide
        open={contextOpen}
        onClose={() => setContextOpen(false)}
      >
        {dock}
      </ResponsiveDrawer>
    </div>
  );
}
