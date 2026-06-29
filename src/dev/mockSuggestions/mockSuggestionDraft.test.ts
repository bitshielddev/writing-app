import { describe, expect, it } from "vitest";

import type { SuggestionKind } from "../../suggestions/types";
import { buildMockSuggestion, type MockSuggestionDraft } from "./mockSuggestionDraft";

const commonDraft = {
  title: "A useful suggestion",
  summary: "Short queue copy",
  body: "Longer detail copy",
  sourceLabels: "Research.pdf\n\nVision.docx ",
};

describe("mock suggestion drafts", () => {
  it.each(["snippet", "fact", "term"] satisfies SuggestionKind[])(
    "builds a %s suggestion with generated common fields",
    (kind) => {
      const suggestion = buildMockSuggestion(
        { ...commonDraft, kind, insertText: "Preview this text" },
        { id: "generated-id", createdAt: 42 },
      );

      expect(suggestion).toMatchObject({
        id: "generated-id",
        dedupeKey: "generated-id",
        kind,
        createdAt: 42,
        sourceLabels: ["Research.pdf", "Vision.docx"],
        insertText: "Preview this text",
      });
    },
  );

  it("accepts recursive structure JSON", () => {
    const draft: MockSuggestionDraft = {
      ...commonDraft,
      kind: "outline",
      nodes: JSON.stringify([
        {
          id: "parent",
          label: "Parent",
          children: [
            { id: "child", label: "Child", detail: "Detail", children: [] },
          ],
        },
      ]),
    };

    expect(
      buildMockSuggestion(draft, { id: "outline-id", createdAt: 43 }),
    ).toMatchObject({
      kind: "outline",
      nodes: [
        {
          id: "parent",
          children: [{ id: "child", label: "Child" }],
        },
      ],
    });
  });

  it("builds a mind map suggestion", () => {
    const suggestion = buildMockSuggestion(
      {
        ...commonDraft,
        kind: "mindMap",
        mermaidSource: "mindmap\n  root((Idea))",
        accessibleDescription: "A map centred on an idea.",
      },
      { id: "map-id", createdAt: 44 },
    );

    expect(suggestion).toMatchObject({
      kind: "mindMap",
      mermaidSource: "mindmap\n  root((Idea))",
      accessibleDescription: "A map centred on an idea.",
    });
  });

  it("rejects malformed or incorrectly shaped structure JSON", () => {
    expect(() =>
      buildMockSuggestion({
        ...commonDraft,
        kind: "layout",
        nodes: "not json",
      }),
    ).toThrow("Nodes must be valid JSON.");

    expect(() =>
      buildMockSuggestion({
        ...commonDraft,
        kind: "layout",
        nodes: JSON.stringify([{ label: "Missing id" }]),
      }),
    ).toThrow("Nodes must be a non-empty array");
  });
});
