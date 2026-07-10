import { useEffect, useRef, useState } from "react";

let mermaidInitialized = false;
let mermaidModule: Promise<typeof import("mermaid")> | undefined;

type MermaidDiagramProps = {
  source: string;
  title: string;
  description: string;
};

/**
 * What: renders the mermaid diagram component and wires its props into the surrounding UI.
 *
 * Why: suggestion UI and state flows need consistent presentation and mutation behavior.
 * Called when: used by SuggestionPresentation and SuggestionVisual when that path needs this behavior.
 */
export function MermaidDiagram({
  source,
  title,
  description,
}: MermaidDiagramProps) {
  return (
    <MermaidDiagramRender
      key={source}
      source={source}
      title={title}
      description={description}
    />
  );
}

/**
 * What: renders the mermaid diagram render component and wires its props into the surrounding UI.
 *
 * Why: suggestion UI and state flows need consistent presentation and mutation behavior.
 * Called when: used by MermaidDiagram when that path needs this behavior.
 */
function MermaidDiagramRender({
  source,
  title,
  description,
}: MermaidDiagramProps) {
  const renderHostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading",
  );

  useEffect(() => {
    let active = true;
    const renderHost = renderHostRef.current;

    if (!renderHost) return;

    /**
     * What: performs the render step for this file's workflow.
     *
     * Why: suggestion UI and state flows need consistent presentation and mutation behavior.
     * Called when: used by MermaidDiagramRender when that path needs this behavior.
     */
    const render = async () => {
      try {
        mermaidModule ??= import("mermaid");
        const mermaid = (await mermaidModule).default;
        if (!mermaidInitialized) {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            theme: "base",
            suppressErrorRendering: true,
            mindmap: { useMaxWidth: true },
          });
          mermaidInitialized = true;
        }

        if (!active) return;

        renderHost.removeAttribute("data-processed");
        renderHost.textContent = source;
        await mermaid.run({ nodes: [renderHost] });
        if (active) {
          setStatus("ready");
        }
      } catch {
        if (active) {
          setStatus("failed");
        }
      }
    };

    void render();
    return () => {
      active = false;
    };
  }, [source]);

  if (status === "failed") {
    return (
      <div
        role="status"
        className="rounded-xl border border-dashed border-[#c9c5dc] bg-white/60 px-5 py-8 text-center"
      >
        <p className="text-sm font-semibold text-[#393844]">Diagram unavailable</p>
        <p className="mt-1 text-xs leading-5 text-[#777386]">{description}</p>
      </div>
    );
  }

  return (
    <div
      role={status === "ready" ? "img" : undefined}
      aria-label={status === "ready" ? `${title}. ${description}` : undefined}
      aria-busy={status === "loading"}
      className="mermaid-diagram relative min-h-56 overflow-auto rounded-xl border border-[#d7d4e8] bg-white p-4"
    >
      <div
        ref={renderHostRef}
        aria-hidden={status !== "ready"}
        className={status === "ready" ? undefined : "invisible"}
      />
      {status === "loading" ? (
        <div
          role="status"
          className="absolute inset-0 grid place-items-center bg-white/55 text-sm text-[#777386]"
        >
          Rendering diagram…
        </div>
      ) : null}
    </div>
  );
}
