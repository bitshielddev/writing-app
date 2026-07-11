import {
  FilePenLine,
  Network,
  StickyNote,
  type LucideIcon,
} from "lucide-react";
import { marked } from "marked";
import { useMemo } from "react";

import {
  isDiagramSuggestion,
  type SuggestionItem,
  type SuggestionKind,
} from "../../../../domain/suggestions/schema";
import { MermaidDiagram } from "./MermaidDiagram";

type KindPresentation = {
  label: string;
  icon: LucideIcon;
  tone: string;
};

const kindPresentation: Record<SuggestionKind, KindPresentation> = {
  edit: { label: "Edit", icon: FilePenLine, tone: "text-brand-700 bg-brand-100" },
  note: { label: "Note", icon: StickyNote, tone: "text-sky-800 bg-sky-100" },
  diagram: { label: "Diagram", icon: Network, tone: "text-fuchsia-800 bg-fuchsia-100" },
};

const ALLOWED_MARKDOWN_TAGS = new Set([
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
]);

const URL_ATTRIBUTES = new Set(["href", "src"]);
const SAFE_URL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function sanitizeMarkdownHtml(html: string) {
  const template = document.createElement("template");
  template.innerHTML = html;

  for (const element of Array.from(template.content.querySelectorAll("*"))) {
    const tagName = element.tagName.toLowerCase();
    if (!ALLOWED_MARKDOWN_TAGS.has(tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (tagName === "a" && name === "href") {
        try {
          const url = new URL(attribute.value, window.location.href);
          if (!SAFE_URL_PROTOCOLS.has(url.protocol)) element.removeAttribute(attribute.name);
        } catch {
          element.removeAttribute(attribute.name);
        }
        continue;
      }
      if (tagName === "a" && (name === "target" || name === "rel")) continue;
      if (URL_ATTRIBUTES.has(name)) element.removeAttribute(attribute.name);
      else element.removeAttribute(attribute.name);
    }

    if (tagName === "a" && element.getAttribute("href")) {
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noreferrer");
    }
  }

  return template.innerHTML;
}

/**
 * What: renders the kind badge component and wires its props into the surrounding UI.
 *
 * Why: suggestion UI and state flows need consistent presentation and mutation behavior.
 * Called when: used by WorkspacePinCard, SuggestionDockDetail, SuggestionDockQueue and QueueRow when that path needs this behavior.
 */
export function KindBadge({ kind }: { kind: SuggestionKind }) {
  const presentation = kindPresentation[kind];
  const Icon = presentation.icon;
  return (
    <span
      className={`inline-flex min-h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-bold ${presentation.tone}`}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {presentation.label}
    </span>
  );
}

export function SuggestionMarkdown({
  markdown,
  className = "",
}: {
  markdown: string;
  className?: string;
}) {
  const html = useMemo(() => {
    const rawHtml = marked.parse(markdown, {
      async: false,
      breaks: true,
      gfm: true,
    });
    return sanitizeMarkdownHtml(rawHtml);
  }, [markdown]);

  return (
    <div
      className={`suggestion-markdown ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/**
 * What: renders the suggestion visual component and wires its props into the surrounding UI.
 *
 * Why: suggestion UI and state flows need consistent presentation and mutation behavior.
 * Called when: used by WorkspacePinCard and SuggestionDockDetail when that path needs this behavior.
 */
export function SuggestionVisual({ item }: { item: SuggestionItem }) {
  if (isDiagramSuggestion(item)) {
    return (
      <MermaidDiagram
        source={item.mermaidSource}
        title={item.title}
        description={item.accessibleDescription}
      />
    );
  }

  return null;
}
