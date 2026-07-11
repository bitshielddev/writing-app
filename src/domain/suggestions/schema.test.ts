import { describe, expect, it } from "vitest";
import { Check } from "typebox/schema";

import {
  SUGGESTION_CAPABILITIES,
  SUGGESTION_KINDS,
  SuggestionToolInputSchema,
  isSuggestionItem,
  parseSuggestionItem,
  type SuggestionItem,
} from "./schema";

const common = {
  id: "suggestion-1",
  dedupeKey: "dedupe-1",
  title: "Useful change",
  summary: "A concise summary",
  body: "Supporting explanation",
  sourceLabels: ["source.md"],
  createdAt: 1_750_000_000_000,
};

const validByKind = {
  edit: {
    ...common,
    kind: "edit",
    sourceDocumentRevision: 1,
    sourceBlockId: "block-1",
    sourceStart: 0,
    sourceEnd: 17,
    sourceText: "Current sentence.",
    newText: "Improved sentence.",
  },
  note: { ...common, kind: "note" },
  diagram: {
    ...common,
    kind: "diagram",
    mermaidSource: "flowchart TD\n  Draft[Draft]",
    accessibleDescription: "A map with Draft at its root.",
  },
} as const satisfies Record<SuggestionItem["kind"], SuggestionItem>;

/**
 * What: performs the without generated fields step for this file's workflow.
 *
 * Why: the test needs a focused helper so assertions stay about the behavior under test.
 * Called when: used by schema when that path needs this behavior.
 */
function withoutGeneratedFields(item: SuggestionItem): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(item).filter(([key]) => key !== "id" && key !== "createdAt"),
  );
}

describe("suggestion domain schema", () => {
  it.each(SUGGESTION_KINDS)("accepts a valid %s suggestion", (kind) => {
    const parsed = parseSuggestionItem(validByKind[kind]);
    expect(parsed).toEqual({ success: true, value: validByKind[kind] });
    expect(isSuggestionItem(validByKind[kind])).toBe(true);
  });

  it.each([
    ["edit", { sourceText: "" }],
    ["edit", { sourceText: "   " }],
    ["edit", { newText: "x".repeat(20_001) }],
    ["diagram", { accessibleDescription: "" }],
    ["diagram", { mermaidSource: "" }],
  ] as const)("rejects an invalid %s payload", (kind, replacement) => {
    expect(
      parseSuggestionItem({ ...validByKind[kind], ...replacement }).success,
    ).toBe(false);
  });

  it("rejects missing common and family fields", () => {
    const withoutTitle: Partial<SuggestionItem> = { ...validByKind.edit };
    const withoutSourceText: Partial<SuggestionItem> = { ...validByKind.edit };
    Reflect.deleteProperty(withoutTitle, "title");
    Reflect.deleteProperty(withoutSourceText, "sourceText");

    expect(parseSuggestionItem(withoutTitle).success).toBe(false);
    expect(parseSuggestionItem(withoutSourceText).success).toBe(false);
  });

  it("rejects cross-family fields, unknown kinds, and extra properties", () => {
    expect(
      parseSuggestionItem({ ...validByKind.note, sourceText: "wrong family" })
        .success,
    ).toBe(false);
    expect(
      parseSuggestionItem({ ...validByKind.edit, mermaidSource: "wrong family" })
        .success,
    ).toBe(false);
    expect(parseSuggestionItem({ ...validByKind.edit, kind: "unknown" }).success)
      .toBe(false);
    expect(parseSuggestionItem({ ...validByKind.diagram, extra: true }).success)
      .toBe(false);
  });

  it("reports an invalid edit path without echoing payload content", () => {
    const parsed = parseSuggestionItem({
      ...validByKind.edit,
      sourceText: "",
      body: "SENSITIVE BODY CONTENT",
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.issues.some((issue) => issue.path === "/sourceText"))
      .toBe(true);
    expect(JSON.stringify(parsed.issues)).not.toContain("SENSITIVE BODY CONTENT");
  });

  it.each([
    ["empty id", { id: "" }],
    ["non-finite timestamp", { createdAt: Number.POSITIVE_INFINITY }],
    ["empty source label", { sourceLabels: [""] }],
  ] as const)("rejects %s", (_case, replacement) => {
    expect(parseSuggestionItem({ ...validByKind.edit, ...replacement }).success)
      .toBe(false);
  });

  it.each(["snippet", "fact", "term", "outline", "layout", "mindMap"] as const)(
    "rejects legacy %s suggestions",
    (kind) => {
      expect(parseSuggestionItem({ ...common, kind, insertText: "legacy" }).success)
        .toBe(false);
    },
  );
});

describe("suggestion capabilities", () => {
  it("exhaustively defines behavior and initial sizing", () => {
    expect(Object.keys(SUGGESTION_CAPABILITIES)).toEqual(SUGGESTION_KINDS);
    for (const kind of SUGGESTION_KINDS) {
      const capabilities = SUGGESTION_CAPABILITIES[kind];
      expect(capabilities.supportsPreview).toBe(capabilities.family === "edit");
      expect(capabilities.supportsAccept).toBe(capabilities.family === "edit");
      expect(capabilities.supportsDisable).toBe(capabilities.family === "edit");
      expect(capabilities.supportsVisualRendering).toBe(
        capabilities.family === "diagram",
      );
      expect(capabilities.supportsWorkspacePlacement).toBe(true);
      expect(capabilities.initialWorkspaceSize.width).toBeGreaterThan(0);
      expect(capabilities.initialWorkspaceSize.height).toBeGreaterThan(0);
    }
  });
});

describe("Pi suggestion tool schema", () => {
  it.each(SUGGESTION_KINDS)(
    "accepts the same valid %s payload after generated fields are added",
    (kind) => {
      const toolInput = withoutGeneratedFields(validByKind[kind]);
      expect(Check(SuggestionToolInputSchema, toolInput)).toBe(true);
      expect(parseSuggestionItem({ ...toolInput, id: "generated", createdAt: 1 }).success)
        .toBe(true);
    },
  );

  it("rejects family drift at both tool and application boundaries", () => {
    const toolInput = withoutGeneratedFields(validByKind.edit);
    const invalid = { ...toolInput, mermaidSource: validByKind.diagram.mermaidSource };
    expect(Check(SuggestionToolInputSchema, invalid)).toBe(false);
    expect(parseSuggestionItem({ ...invalid, id: "generated", createdAt: 1 }).success)
      .toBe(false);
  });
});
