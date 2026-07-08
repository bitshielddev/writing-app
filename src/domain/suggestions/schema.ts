import { Type, type Static } from "typebox";
import { Check, Errors } from "typebox/schema";

const strictObject = { additionalProperties: false } as const;
const nonEmptyString = (maxLength: number) =>
  Type.String({ minLength: 1, maxLength, pattern: "\\S" });

const commonSuggestionProperties = {
  id: nonEmptyString(200),
  dedupeKey: nonEmptyString(200),
  title: nonEmptyString(200),
  summary: nonEmptyString(1_000),
  body: nonEmptyString(8_000),
  sourceLabels: Type.Array(nonEmptyString(200), { maxItems: 12 }),
  createdAt: Type.Number(),
};

export const StructureNodeSchema = Type.Cyclic(
  {
    StructureNode: Type.Object(
      {
        id: nonEmptyString(200),
        label: nonEmptyString(1_000),
        detail: Type.Optional(Type.String({ maxLength: 8_000 })),
        children: Type.Optional(
          Type.Array(Type.Ref("StructureNode"), { maxItems: 100 }),
        ),
      },
      strictObject,
    ),
  },
  "StructureNode",
);

export const StructureNodesSchema = Type.Array(StructureNodeSchema, {
  minItems: 1,
  maxItems: 100,
});

function textSuggestionSchema<Kind extends "snippet" | "fact" | "term">(
  kind: Kind,
) {
  return Type.Object(
    {
      ...commonSuggestionProperties,
      kind: Type.Literal(kind),
      insertText: nonEmptyString(20_000),
    },
    strictObject,
  );
}

function structureSuggestionSchema<Kind extends "outline" | "layout">(
  kind: Kind,
) {
  return Type.Object(
    {
      ...commonSuggestionProperties,
      kind: Type.Literal(kind),
      nodes: StructureNodesSchema,
    },
    strictObject,
  );
}

export const SnippetSuggestionSchema = textSuggestionSchema("snippet");
export const FactSuggestionSchema = textSuggestionSchema("fact");
export const TermSuggestionSchema = textSuggestionSchema("term");
export const OutlineSuggestionSchema = structureSuggestionSchema("outline");
export const LayoutSuggestionSchema = structureSuggestionSchema("layout");
export const MindMapSuggestionSchema = Type.Object(
  {
    ...commonSuggestionProperties,
    kind: Type.Literal("mindMap"),
    mermaidSource: nonEmptyString(20_000),
    accessibleDescription: nonEmptyString(4_000),
  },
  strictObject,
);

export const CONCRETE_SUGGESTION_SCHEMAS = [
  SnippetSuggestionSchema,
  FactSuggestionSchema,
  TermSuggestionSchema,
  OutlineSuggestionSchema,
  LayoutSuggestionSchema,
  MindMapSuggestionSchema,
] as const;

export const SuggestionItemSchema = Type.Union([
  ...CONCRETE_SUGGESTION_SCHEMAS,
]);

export type SuggestionItem = Static<typeof SuggestionItemSchema>;
export type SuggestionKind = SuggestionItem["kind"];
export type TextSuggestion = Extract<
  SuggestionItem,
  { kind: "snippet" | "fact" | "term" }
>;
export type TextSuggestionKind = TextSuggestion["kind"];
export type StructureSuggestion = Extract<
  SuggestionItem,
  { kind: "outline" | "layout" }
>;
export type StructureSuggestionKind = StructureSuggestion["kind"];
export type MindMapSuggestion = Extract<SuggestionItem, { kind: "mindMap" }>;
export type StructureNode = Static<typeof StructureNodeSchema>;

export const SUGGESTION_SCHEMAS_BY_KIND = {
  snippet: SnippetSuggestionSchema,
  fact: FactSuggestionSchema,
  term: TermSuggestionSchema,
  outline: OutlineSuggestionSchema,
  layout: LayoutSuggestionSchema,
  mindMap: MindMapSuggestionSchema,
} as const satisfies Record<SuggestionKind, (typeof CONCRETE_SUGGESTION_SCHEMAS)[number]>;

export type SuggestionValidationIssue = {
  path: string;
  code: string;
  message: string;
};

export type SuggestionParseResult =
  | { success: true; value: SuggestionItem }
  | { success: false; issues: SuggestionValidationIssue[] };

function safeIssue(error: ReturnType<typeof Errors>[1][number]): SuggestionValidationIssue {
  return {
    path: error.instancePath || "/",
    code: error.keyword,
    message: error.message,
  };
}

export function parseSuggestionItem(value: unknown): SuggestionParseResult {
  const kind =
    typeof value === "object" && value !== null && "kind" in value
      ? value.kind
      : undefined;
  const schema =
    typeof kind === "string" &&
    Object.prototype.hasOwnProperty.call(SUGGESTION_SCHEMAS_BY_KIND, kind)
      ? SUGGESTION_SCHEMAS_BY_KIND[kind as SuggestionKind]
      : SuggestionItemSchema;
  if (Check(schema, value)) {
    return { success: true, value: value as SuggestionItem };
  }
  const [, errors] = Errors(schema, value);
  return { success: false, issues: errors.map(safeIssue) };
}

export function isSuggestionItem(value: unknown): value is SuggestionItem {
  return Check(SuggestionItemSchema, value);
}

export function isStructureNodes(value: unknown): value is StructureNode[] {
  return Check(StructureNodesSchema, value);
}

export function formatSuggestionValidationIssues(
  issues: readonly SuggestionValidationIssue[],
): string {
  return issues
    .map((issue) => `${issue.path} (${issue.code}): ${issue.message}`)
    .join("; ");
}

export type SuggestionCapabilities = {
  family: "text" | "structure" | "mindMap";
  supportsPreview: boolean;
  supportsVisualRendering: boolean;
  supportsWorkspacePlacement: boolean;
  initialWorkspaceSize: { width: number; height: number };
};

export const SUGGESTION_CAPABILITIES = {
  snippet: {
    family: "text",
    supportsPreview: true,
    supportsVisualRendering: false,
    supportsWorkspacePlacement: true,
    initialWorkspaceSize: { width: 320, height: 240 },
  },
  fact: {
    family: "text",
    supportsPreview: true,
    supportsVisualRendering: false,
    supportsWorkspacePlacement: true,
    initialWorkspaceSize: { width: 320, height: 240 },
  },
  term: {
    family: "text",
    supportsPreview: true,
    supportsVisualRendering: false,
    supportsWorkspacePlacement: true,
    initialWorkspaceSize: { width: 320, height: 240 },
  },
  outline: {
    family: "structure",
    supportsPreview: false,
    supportsVisualRendering: true,
    supportsWorkspacePlacement: true,
    initialWorkspaceSize: { width: 380, height: 300 },
  },
  layout: {
    family: "structure",
    supportsPreview: false,
    supportsVisualRendering: true,
    supportsWorkspacePlacement: true,
    initialWorkspaceSize: { width: 380, height: 300 },
  },
  mindMap: {
    family: "mindMap",
    supportsPreview: false,
    supportsVisualRendering: true,
    supportsWorkspacePlacement: true,
    initialWorkspaceSize: { width: 460, height: 340 },
  },
} as const satisfies Record<SuggestionKind, SuggestionCapabilities>;

export const SUGGESTION_KINDS = Object.keys(
  SUGGESTION_CAPABILITIES,
) as SuggestionKind[];

export function isSuggestionKind(value: unknown): value is SuggestionKind {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(SUGGESTION_CAPABILITIES, value)
  );
}

export function isTextSuggestionKind(value: unknown): value is TextSuggestionKind {
  return isSuggestionKind(value) && SUGGESTION_CAPABILITIES[value].family === "text";
}

export function isStructureSuggestionKind(
  value: unknown,
): value is StructureSuggestionKind {
  return (
    isSuggestionKind(value) &&
    SUGGESTION_CAPABILITIES[value].family === "structure"
  );
}

export function isMindMapSuggestionKind(value: unknown): value is "mindMap" {
  return (
    isSuggestionKind(value) &&
    SUGGESTION_CAPABILITIES[value].family === "mindMap"
  );
}

export function isTextSuggestion(item: SuggestionItem): item is TextSuggestion {
  return SUGGESTION_CAPABILITIES[item.kind].family === "text";
}

export function isStructureSuggestion(
  item: SuggestionItem,
): item is StructureSuggestion {
  return SUGGESTION_CAPABILITIES[item.kind].family === "structure";
}

export function isMindMapSuggestion(
  item: SuggestionItem,
): item is MindMapSuggestion {
  return SUGGESTION_CAPABILITIES[item.kind].family === "mindMap";
}

export function supportsSuggestionPreview(
  item: SuggestionItem,
): item is TextSuggestion {
  return SUGGESTION_CAPABILITIES[item.kind].supportsPreview;
}

export function isVisualSuggestion(
  item: SuggestionItem,
): item is StructureSuggestion | MindMapSuggestion {
  return SUGGESTION_CAPABILITIES[item.kind].supportsVisualRendering;
}

export function supportsWorkspacePlacement(item: SuggestionItem): boolean {
  return SUGGESTION_CAPABILITIES[item.kind].supportsWorkspacePlacement;
}

const TOOL_OMITTED_FIELDS = ["id", "createdAt"] as const;
export const SuggestionToolInputSchema = Type.Union(
  [
    Type.Omit(SnippetSuggestionSchema, TOOL_OMITTED_FIELDS, strictObject),
    Type.Omit(FactSuggestionSchema, TOOL_OMITTED_FIELDS, strictObject),
    Type.Omit(TermSuggestionSchema, TOOL_OMITTED_FIELDS, strictObject),
    Type.Omit(OutlineSuggestionSchema, TOOL_OMITTED_FIELDS, strictObject),
    Type.Omit(LayoutSuggestionSchema, TOOL_OMITTED_FIELDS, strictObject),
    Type.Omit(MindMapSuggestionSchema, TOOL_OMITTED_FIELDS, strictObject),
  ],
);
export type SuggestionToolInput = Static<typeof SuggestionToolInputSchema>;

export const SuggestionToolUpdateInputSchema = Type.Union(
  [
    Type.Omit(SnippetSuggestionSchema, ["createdAt"], strictObject),
    Type.Omit(FactSuggestionSchema, ["createdAt"], strictObject),
    Type.Omit(TermSuggestionSchema, ["createdAt"], strictObject),
    Type.Omit(OutlineSuggestionSchema, ["createdAt"], strictObject),
    Type.Omit(LayoutSuggestionSchema, ["createdAt"], strictObject),
    Type.Omit(MindMapSuggestionSchema, ["createdAt"], strictObject),
  ],
);
export type SuggestionToolUpdateInput = Static<
  typeof SuggestionToolUpdateInputSchema
>;

export type SuggestionEvent =
  | { type: "suggestion.added"; item: SuggestionItem }
  | { type: "suggestion.updated"; item: SuggestionItem }
  | { type: "suggestion.retracted"; id: string }
  | {
      type: "suggestion.state.changed";
      suggestionId: string;
      commandType: string;
    };
