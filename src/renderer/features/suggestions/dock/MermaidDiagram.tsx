import { useEffect, useRef, useState } from "react";

let mermaidModule: Promise<typeof import("mermaid")> | undefined;
let mermaidThemeSignature: string | undefined;

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
  const [themeRevision, setThemeRevision] = useState(0);

  useEffect(() => {
    const refresh = () => setThemeRevision((revision) => revision + 1);
    window.addEventListener("scribe-theme-change", refresh);
    return () => window.removeEventListener("scribe-theme-change", refresh);
  }, []);

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
          const styles = getComputedStyle(document.documentElement);
          const themeVariables = {
            background: styles.getPropertyValue("--surface").trim(),
            primaryColor: styles.getPropertyValue("--panel").trim(),
            primaryTextColor: styles.getPropertyValue("--foreground").trim(),
            primaryBorderColor: styles.getPropertyValue("--border").trim(),
            lineColor: styles.getPropertyValue("--muted-foreground").trim(),
            secondaryColor: styles.getPropertyValue("--accent").trim(),
            tertiaryColor: styles.getPropertyValue("--muted").trim(),
          };
          const themeSignature = JSON.stringify(themeVariables);
          if (themeSignature !== mermaidThemeSignature) mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            theme: "base",
            suppressErrorRendering: true,
            mindmap: { useMaxWidth: true },
            themeVariables,
          });
          mermaidThemeSignature = themeSignature;

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
  }, [source, themeRevision]);

  if (status === "failed") {
    return (
      <div
        role="status"
        className="rounded-xl border border-dashed border-border bg-surface-raised/60 px-5 py-8 text-center"
      >
        <p className="text-sm font-semibold text-foreground">Diagram unavailable</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
    );
  }

  return (
    <div
      role={status === "ready" ? "img" : undefined}
      aria-label={status === "ready" ? `${title}. ${description}` : undefined}
      aria-busy={status === "loading"}
      className="mermaid-diagram relative min-h-56 overflow-auto rounded-xl border border-border bg-surface-raised p-4"
    >
      <div
        ref={renderHostRef}
        aria-hidden={status !== "ready"}
        className={status === "ready" ? undefined : "invisible"}
      />
      {status === "loading" ? (
        <div
          role="status"
          className="absolute inset-0 grid place-items-center bg-surface-raised/55 text-sm text-muted-foreground"
        >
          Rendering diagram…
        </div>
      ) : null}
    </div>
  );
}
