import { Type, type Static } from "typebox";
import { Check, Errors } from "typebox/schema";

const strictObject = { additionalProperties: false } as const;
/**
 * What: performs the non empty string step for this file's workflow.
 *
 * Why: suggestion state must remain deterministic across storage, agent, and renderer code.
 * Called when: used by schema and textSuggestionSchema when that path needs this behavior.
 */
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

/**
 * What: performs the edit suggestion schema step for this file's workflow.
 *
 * Why: suggestion state must remain deterministic across storage, agent, and renderer code.
 * Called when: used by schema when that path needs this behavior.
 */
export const EditSuggestionSchema = Type.Object(
  {
    ...commonSuggestionProperties,
    kind: Type.Literal("edit"),
    sourceText: nonEmptyString(20_000),
    newText: Type.String({ maxLength: 20_000 }),
  },
  strictObject,
);
export const NoteSuggestionSchema = Type.Object(
  {
    ...commonSuggestionProperties,
    kind: Type.Literal("note"),
  },
  strictObject,
);
export const DiagramSuggestionSchema = Type.Object(
  {
    ...commonSuggestionProperties,
    kind: Type.Literal("diagram"),
    mermaidSource: nonEmptyString(20_000),
    accessibleDescription: nonEmptyString(4_000),
  },
  strictObject,
);

export const CONCRETE_SUGGESTION_SCHEMAS = [
  EditSuggestionSchema,
  NoteSuggestionSchema,
  DiagramSuggestionSchema,
] as const;

export const SuggestionItemSchema = Type.Union([
  ...CONCRETE_SUGGESTION_SCHEMAS,
]);

export type SuggestionItem = Static<typeof SuggestionItemSchema>;
export type SuggestionKind = SuggestionItem["kind"];
export type EditSuggestion = Extract<SuggestionItem, { kind: "edit" }>;
export type NoteSuggestion = Extract<SuggestionItem, { kind: "note" }>;
export type DiagramSuggestion = Extract<SuggestionItem, { kind: "diagram" }>;

export const SUGGESTION_SCHEMAS_BY_KIND = {
  edit: EditSuggestionSchema,
  note: NoteSuggestionSchema,
  diagram: DiagramSuggestionSchema,
} as const satisfies Record<SuggestionKind, (typeof CONCRETE_SUGGESTION_SCHEMAS)[number]>;

export type SuggestionValidationIssue = {
  path: string;
  code: string;
  message: string;
};

export type SuggestionParseResult =
  | { success: true; value: SuggestionItem }
  | { success: false; issues: SuggestionValidationIssue[] };

/**
 * What: performs the safe issue step for this file's workflow.
 *
 * Why: suggestion state must remain deterministic across storage, agent, and renderer code.
 * Called when: used by parseSuggestionItem when that path needs this behavior.
 */
function safeIssue(error: ReturnType<typeof Errors>[1][number]): SuggestionValidationIssue {
  return {
    path: error.instancePath || "/",
    code: error.keyword,
    message: error.message,
  };
}

/**
 * What: parses suggestion item from untyped data into the typed representation.
 *
 * Why: suggestion state must remain deterministic across storage, agent, and renderer code.
 * Called when: used by schema, extension and toSuggestion when that path needs this behavior.
 */
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

/**
 * What: returns whether the supplied value matches suggestion item.
 *
 * Why: suggestion state must remain deterministic across storage, agent, and renderer code.
 * Called when: used by schema when that path needs this behavior.
 */
export function isSuggestionItem(value: unknown): value is SuggestionItem {
  return Check(SuggestionItemSchema, value);
}

/**
 * What: formats suggestion validation issues for display, validation output, or diagnostics.
 *
 * Why: suggestion state must remain deterministic across storage, agent, and renderer code.
 * Called when: used by extension and toSuggestion when that path needs this behavior.
 */
export function formatSuggestionValidationIssues(
  issues: readonly SuggestionValidationIssue[],
): string {
  return issues
    .map((issue) => `${issue.path} (${issue.code}): ${issue.message}`)
    .join("; ");
}

export type SuggestionCapabilities = {
  family: "edit" | "note" | "diagram";
  supportsPreview: boolean;
  supportsAccept: boolean;
  supportsDisable: boolean;
  supportsVisualRendering: boolean;
  supportsWorkspacePlacement: boolean;
  initialWorkspaceSize: { width: number; height: number };
};

export const SUGGESTION_CAPABILITIES = {
  edit: {
    family: "edit",
    supportsPreview: true,
    supportsAccept: true,
    supportsDisable: true,
    supportsVisualRendering: false,
    supportsWorkspacePlacement: true,
    initialWorkspaceSize: { width: 320, height: 240 },
  },
  note: {
    family: "note",
    supportsPreview: false,
    supportsAccept: false,
    supportsDisable: false,
    supportsVisualRendering: false,
    supportsWorkspacePlacement: true,
    initialWorkspaceSize: { width: 340, height: 240 },
  },
  diagram: {
    family: "diagram",
    supportsPreview: false,
    supportsAccept: false,
    supportsDisable: false,
    supportsVisualRendering: true,
    supportsWorkspacePlacement: true,
    initialWorkspaceSize: { width: 460, height: 340 },
  },
} as const satisfies Record<SuggestionKind, SuggestionCapabilities>;

export const SUGGESTION_KINDS = Object.keys(
  SUGGESTION_CAPABILITIES,
) as SuggestionKind[];

/**
 * What: returns whether the supplied value matches suggestion kind.
 *
 * Why: suggestion state must remain deterministic across storage, agent, and renderer code.
 * Called when: used by suggestion kind guards and state when that path needs this behavior.
 */
export function isSuggestionKind(value: unknown): value is SuggestionKind {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(SUGGESTION_CAPABILITIES, value)
  );
}

/**
 * What: returns whether the supplied value matches edit suggestion kind.
 *
 * Why: suggestion state must remain deterministic across storage, agent, and renderer code.
 * Called when: used by state when that path needs this behavior.
 */
export function isEditSuggestionKind(value: unknown): value is "edit" {
  return isSuggestionKind(value) && SUGGESTION_CAPABILITIES[value].family === "edit";
}

/**
 * What: returns whether the supplied value matches edit suggestion.
 *
 * Why: suggestion state must remain deterministic across storage, agent, and renderer code.
 * Called when: used by state when that path needs this behavior.
 */
export function isEditSuggestion(item: SuggestionItem): item is EditSuggestion {
  return SUGGESTION_CAPABILITIES[item.kind].family === "edit";
}

/**
 * What: returns whether the supplied value matches note suggestion.
 *
 * Why: suggestion state must remain deterministic across storage, agent, and renderer code.
 * Called when: used by state when that path needs this behavior.
 */
export function isNoteSuggestion(item: SuggestionItem): item is NoteSuggestion {
  return SUGGESTION_CAPABILITIES[item.kind].family === "note";
}

/**
 * What: returns whether the supplied value matches diagram suggestion.
 *
 * Why: suggestion state must remain deterministic across storage, agent, and renderer code.
 * Called when: used by state, SuggestionPresentation and SuggestionVisual when that path needs this behavior.
 */
export function isDiagramSuggestion(item: SuggestionItem): item is DiagramSuggestion {
  return SUGGESTION_CAPABILITIES[item.kind].family === "diagram";
}

/**
 * What: returns whether the suggestion or value supports suggestion preview.
 *
 * Why: suggestion state must remain deterministic across storage, agent, and renderer code.
 * Called when: used by SuggestionDockDetail, useWorkspaceKeybindings and usePreviewController when that path needs this behavior.
 */
export function supportsSuggestionPreview(
  item: SuggestionItem,
): item is EditSuggestion {
  return SUGGESTION_CAPABILITIES[item.kind].supportsPreview;
}

export function supportsSuggestionAccept(item: SuggestionItem): item is EditSuggestion {
  return SUGGESTION_CAPABILITIES[item.kind].supportsAccept;
}

/**
 * What: returns whether the supplied value matches visual suggestion.
 *
 * Why: suggestion state must remain deterministic across storage, agent, and renderer code.
 * Called when: used by state, WorkspacePinCard and SuggestionDockDetail when that path needs this behavior.
 */
export function isVisualSuggestion(
  item: SuggestionItem,
): item is DiagramSuggestion {
  return SUGGESTION_CAPABILITIES[item.kind].supportsVisualRendering;
}

/**
 * What: returns whether the suggestion or value supports workspace placement.
 *
 * Why: suggestion state must remain deterministic across storage, agent, and renderer code.
 * Called when: used by SuggestionDockDetail and useWorkspaceController when that path needs this behavior.
 */
export function supportsWorkspacePlacement(item: SuggestionItem): boolean {
  return SUGGESTION_CAPABILITIES[item.kind].supportsWorkspacePlacement;
}

const TOOL_OMITTED_FIELDS = ["id", "createdAt"] as const;
export const SuggestionToolInputSchema = Type.Union(
  [
    Type.Omit(EditSuggestionSchema, TOOL_OMITTED_FIELDS, strictObject),
    Type.Omit(NoteSuggestionSchema, TOOL_OMITTED_FIELDS, strictObject),
    Type.Omit(DiagramSuggestionSchema, TOOL_OMITTED_FIELDS, strictObject),
  ],
);
export type SuggestionToolInput = Static<typeof SuggestionToolInputSchema>;

export const SuggestionToolUpdateInputSchema = Type.Union(
  [
    Type.Omit(EditSuggestionSchema, ["createdAt"], strictObject),
    Type.Omit(NoteSuggestionSchema, ["createdAt"], strictObject),
    Type.Omit(DiagramSuggestionSchema, ["createdAt"], strictObject),
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
