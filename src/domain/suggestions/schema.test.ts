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
  snippet: { ...common, kind: "snippet", insertText: "Inserted snippet" },
  fact: { ...common, kind: "fact", insertText: "Inserted fact" },
  term: { ...common, kind: "term", insertText: "Inserted definition" },
  outline: {
    ...common,
    kind: "outline",
    nodes: [
      {
        id: "section",
        label: "Section",
        children: [{ id: "point", label: "Nested point" }],
      },
    ],
  },
  layout: {
    ...common,
    kind: "layout",
    nodes: [{ id: "opening", label: "Opening", detail: "Lead with context" }],
  },
  mindMap: {
    ...common,
    kind: "mindMap",
    mermaidSource: "mindmap\n  root((Draft))",
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
    ["snippet", { insertText: "" }],
    ["fact", { insertText: "   " }],
    ["term", { insertText: undefined }],
    ["outline", { nodes: [] }],
    ["layout", { nodes: [{ id: "node", label: "" }] }],
    ["mindMap", { accessibleDescription: "" }],
  ] as const)("rejects an invalid %s payload", (kind, replacement) => {
    expect(
      parseSuggestionItem({ ...validByKind[kind], ...replacement }).success,
    ).toBe(false);
  });

  it("rejects missing common and family fields", () => {
    const withoutTitle: Partial<SuggestionItem> = { ...validByKind.snippet };
    const withoutInsertText: Partial<SuggestionItem> = { ...validByKind.snippet };
    Reflect.deleteProperty(withoutTitle, "title");
    Reflect.deleteProperty(withoutInsertText, "insertText");

    expect(parseSuggestionItem(withoutTitle).success).toBe(false);
    expect(parseSuggestionItem(withoutInsertText).success).toBe(false);
  });

  it("rejects cross-family fields, unknown kinds, and extra properties", () => {
    expect(
      parseSuggestionItem({ ...validByKind.snippet, nodes: validByKind.outline.nodes })
        .success,
    ).toBe(false);
    expect(
      parseSuggestionItem({ ...validByKind.outline, insertText: "wrong family" })
        .success,
    ).toBe(false);
    expect(parseSuggestionItem({ ...validByKind.snippet, kind: "unknown" }).success)
      .toBe(false);
    expect(parseSuggestionItem({ ...validByKind.mindMap, extra: true }).success)
      .toBe(false);
  });

  it("reports a nested structure path without echoing payload content", () => {
    const secret = "SENSITIVE NODE CONTENT";
    const parsed = parseSuggestionItem({
      ...validByKind.outline,
      nodes: [
        {
          id: "parent",
          label: "Parent",
          children: [{ id: "child", label: "", detail: secret }],
        },
      ],
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.issues.some((issue) => issue.path === "/nodes/0/children/0/label"))
      .toBe(true);
    expect(JSON.stringify(parsed.issues)).not.toContain(secret);
  });

  it.each([
    ["empty id", { id: "" }],
    ["non-finite timestamp", { createdAt: Number.POSITIVE_INFINITY }],
    ["empty source label", { sourceLabels: [""] }],
  ] as const)("rejects %s", (_case, replacement) => {
    expect(parseSuggestionItem({ ...validByKind.snippet, ...replacement }).success)
      .toBe(false);
  });
});

describe("suggestion capabilities", () => {
  it("exhaustively defines behavior and initial sizing", () => {
    expect(Object.keys(SUGGESTION_CAPABILITIES)).toEqual(SUGGESTION_KINDS);
    for (const kind of SUGGESTION_KINDS) {
      const capabilities = SUGGESTION_CAPABILITIES[kind];
      expect(capabilities.supportsPreview).toBe(capabilities.family === "text");
      expect(capabilities.supportsVisualRendering).toBe(
        capabilities.family !== "text",
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
    const toolInput = withoutGeneratedFields(validByKind.snippet);
    const invalid = { ...toolInput, nodes: validByKind.outline.nodes };
    expect(Check(SuggestionToolInputSchema, invalid)).toBe(false);
    expect(parseSuggestionItem({ ...invalid, id: "generated", createdAt: 1 }).success)
      .toBe(false);
  });
});
