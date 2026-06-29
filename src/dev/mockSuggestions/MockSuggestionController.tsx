import { type FormEvent, useEffect, useRef, useState } from "react";

import type { SuggestionKind } from "../../suggestions/types";
import {
  createMockSuggestionPublisher,
  type MockSuggestionPublisher,
} from "./mockSuggestionChannel";
import {
  buildMockSuggestion,
  type MockSuggestionDraft,
} from "./mockSuggestionDraft";

type MockSuggestionControllerProps = {
  createPublisher?: () => MockSuggestionPublisher | null;
  channelSupported?: boolean;
};

const kindOptions: Array<{ value: SuggestionKind; label: string }> = [
  { value: "snippet", label: "Snippet" },
  { value: "fact", label: "Fact" },
  { value: "term", label: "Term" },
  { value: "outline", label: "Outline" },
  { value: "layout", label: "Layout" },
  { value: "mindMap", label: "Mind map" },
];

const nodesExample = `[
  {
    "id": "section-1",
    "label": "First section",
    "detail": "Optional supporting detail",
    "children": [
      { "id": "section-1-a", "label": "Nested point" }
    ]
  }
]`;

const inputClassName =
  "mt-1.5 w-full rounded-lg border border-[#d7d4e8] bg-white px-3.5 py-2.5 text-sm text-[#1a1b22] shadow-sm focus:border-brand-400 focus:outline focus:outline-3 focus:outline-brand-200";

function readFormString(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export function MockSuggestionController({
  createPublisher = createMockSuggestionPublisher,
  channelSupported = typeof BroadcastChannel !== "undefined",
}: MockSuggestionControllerProps) {
  const [kind, setKind] = useState<SuggestionKind>("snippet");
  const [message, setMessage] = useState<
    { type: "success" | "error"; text: string } | undefined
  >();
  const publisherRef = useRef<MockSuggestionPublisher | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!channelSupported) {
      return undefined;
    }
    const publisher = createPublisher();
    publisherRef.current = publisher;

    return () => {
      publisher?.close();
      publisherRef.current = null;
    };
  }, [channelSupported, createPublisher]);

  const submitSuggestion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const draft: MockSuggestionDraft = {
      kind,
      title: readFormString(formData, "title"),
      summary: readFormString(formData, "summary"),
      body: readFormString(formData, "body"),
      sourceLabels: readFormString(formData, "sourceLabels"),
      insertText: readFormString(formData, "insertText"),
      nodes: readFormString(formData, "nodes"),
      mermaidSource: readFormString(formData, "mermaidSource"),
      accessibleDescription: readFormString(
        formData,
        "accessibleDescription",
      ),
    };

    try {
      const publisher = publisherRef.current;
      if (!publisher) {
        throw new Error("The live mock channel is unavailable.");
      }
      const suggestion = buildMockSuggestion(draft);
      publisher.publish(suggestion);
      formRef.current?.reset();
      setKind("snippet");
      setMessage({
        type: "success",
        text: `Sent “${suggestion.title}” to the live mock channel.`,
      });
    } catch (error) {
      setMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "The suggestion could not be sent.",
      });
    }
  };

  const isTextKind = kind === "snippet" || kind === "fact" || kind === "term";
  const isStructureKind = kind === "outline" || kind === "layout";

  return (
    <main className="min-h-dvh bg-[#f7f6ff] px-4 py-8 sm:px-6 lg:py-12">
      <div className="mx-auto max-w-3xl">
        <header>
          <p className="text-xs font-extrabold tracking-[0.12em] text-brand-700 uppercase">
            Temporary development tool
          </p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-[-0.03em] text-[#1a1b22]">
            Mock suggestion controller
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#686577]">
            Keep the writing app open in another tab on this origin. Suggestions
            are delivered live and are not saved or replayed.
          </p>
          <a
            href="/"
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex min-h-10 items-center rounded-lg border border-brand-300 bg-white px-3.5 text-sm font-bold text-brand-700 hover:bg-brand-50 focus:outline focus:outline-3 focus:outline-brand-200"
          >
            Open writing workspace
          </a>
        </header>

        <form
          ref={formRef}
          className="mt-8 grid gap-5 rounded-2xl border border-[#dedbe9] bg-white p-5 shadow-xl shadow-brand-900/5 sm:p-7"
          onSubmit={submitSuggestion}
        >
          <label className="text-sm font-bold text-[#393844]">
            Kind
            <select
              name="kind"
              value={kind}
              className={inputClassName}
              onChange={(event) => {
                setKind(event.target.value as SuggestionKind);
                setMessage(undefined);
              }}
            >
              {kindOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm font-bold text-[#393844]">
            Title
            <input name="title" required className={inputClassName} />
          </label>

          <label className="text-sm font-bold text-[#393844]">
            Summary
            <textarea
              name="summary"
              required
              rows={2}
              className={inputClassName}
            />
          </label>

          <label className="text-sm font-bold text-[#393844]">
            Body
            <textarea
              name="body"
              required
              rows={4}
              className={inputClassName}
            />
          </label>

          <label className="text-sm font-bold text-[#393844]">
            Source labels
            {" "}
            <span className="ml-2 text-xs font-medium text-[#8b8798]">
              Optional, one per line
            </span>
            <textarea name="sourceLabels" rows={2} className={inputClassName} />
          </label>

          {isTextKind ? (
            <label className="text-sm font-bold text-[#393844]">
              Insert text
              <textarea
                name="insertText"
                required
                rows={3}
                className={inputClassName}
              />
            </label>
          ) : null}

          {isStructureKind ? (
            <label className="text-sm font-bold text-[#393844]">
              Nodes JSON
              <textarea
                name="nodes"
                required
                rows={12}
                defaultValue={nodesExample}
                spellCheck={false}
                className={`${inputClassName} font-mono text-xs leading-5`}
              />
            </label>
          ) : null}

          {kind === "mindMap" ? (
            <>
              <label className="text-sm font-bold text-[#393844]">
                Mermaid source
                <textarea
                  name="mermaidSource"
                  required
                  rows={9}
                  spellCheck={false}
                  placeholder={`mindmap\n  root((Main idea))\n    Supporting point`}
                  className={`${inputClassName} font-mono text-xs leading-5`}
                />
              </label>
              <label className="text-sm font-bold text-[#393844]">
                Accessible description
                <textarea
                  name="accessibleDescription"
                  required
                  rows={3}
                  className={inputClassName}
                />
              </label>
            </>
          ) : null}

          {!channelSupported ? (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-900"
            >
              This browser does not support BroadcastChannel, so it cannot
              inject mock suggestions.
            </p>
          ) : message ? (
            <p
              role={message.type === "error" ? "alert" : "status"}
              className={`rounded-lg px-4 py-3 text-sm font-medium ${
                message.type === "error"
                  ? "border border-red-200 bg-red-50 text-red-900"
                  : "border border-emerald-200 bg-emerald-50 text-emerald-900"
              }`}
            >
              {message.text}
            </p>
          ) : null}

          <div className="flex justify-end border-t border-[#e8e5f2] pt-5">
            <button
              type="submit"
              disabled={!channelSupported}
              className="min-h-11 rounded-lg bg-brand-600 px-5 text-sm font-bold text-white shadow-md shadow-brand-600/15 hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-[#aaa6bd]"
            >
              Send suggestion
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
