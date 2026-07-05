import { type FormEvent, useRef, useState } from "react";

import {
  isMindMapSuggestionKind,
  isStructureSuggestionKind,
  isTextSuggestionKind,
  type SuggestionItem,
  type SuggestionKind,
} from "../../suggestions/types";
import {
  buildMockSuggestion,
  type MockSuggestionDraft,
} from "./mockSuggestionDraft";

type MockSuggestionControllerProps = {
  createSuggestion: (
    item: SuggestionItem,
  ) => Promise<{ accepted: boolean }>;
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
  createSuggestion,
}: MockSuggestionControllerProps) {
  const [kind, setKind] = useState<SuggestionKind>("snippet");
  const [message, setMessage] = useState<
    { type: "success" | "error"; text: string } | undefined
  >();
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const submitSuggestion = async (event: FormEvent<HTMLFormElement>) => {
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

    setSubmitting(true);
    setMessage(undefined);
    try {
      const suggestion = buildMockSuggestion(draft);
      const result = await createSuggestion(suggestion);
      if (!result.accepted) {
        throw new Error("The suggestion was rejected as a duplicate.");
      }
      formRef.current?.reset();
      setKind("snippet");
      setMessage({
        type: "success",
        text: `Added “${suggestion.title}” to the persisted suggestion inbox.`,
      });
    } catch (error) {
      setMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "The suggestion could not be sent.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const isTextKind = isTextSuggestionKind(kind);
  const isStructureKind = isStructureSuggestionKind(kind);

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
            Suggestions are written through the Electron development bridge and
            persist in the same inbox as agent suggestions.
          </p>
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

          {isMindMapSuggestionKind(kind) ? (
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

          {message ? (
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
              disabled={submitting}
              className="min-h-11 rounded-lg bg-brand-600 px-5 text-sm font-bold text-white shadow-md shadow-brand-600/15 hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-[#aaa6bd]"
            >
              {submitting ? "Sending…" : "Send suggestion"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
