import { Type } from "typebox";

import { identifier, revision, strict, text, timestamp } from "../base";
import { SuggestionItemSchema } from "../../domain/suggestions/schema";
import {
  DocumentBlocksSchema,
  DurableEventEnvelopeSchema,
} from "../events";

export const noParams = Type.Undefined();
export const documentScope = Type.Object({ projectId: identifier, documentId: identifier }, strict);
export const projectIdentity = Type.Object({ projectId: identifier }, strict);
export const namedProject = Type.Object({ name: text(1_000) }, strict);
export const renamedProject = Type.Object({ projectId: identifier, name: text(1_000) }, strict);
export const namedDocument = Type.Object({ projectId: identifier, title: text(1_000) }, strict);
export const renamedDocument = Type.Object({
  projectId: identifier, documentId: identifier, title: text(1_000),
}, strict);
export const accepted = Type.Object({ accepted: Type.Boolean() }, strict);
export const replayParams = Type.Object({
  projectId: identifier,
  documentId: identifier,
  streamId: identifier,
  afterSequence: Type.Integer({ minimum: 0 }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
}, strict);
export const replayResult = Type.Object({
  streamId: identifier,
  events: Type.Array(DurableEventEnvelopeSchema, { maxItems: 100 }),
  headSequence: Type.Integer({ minimum: 0 }),
  hasMore: Type.Boolean(),
  historyAvailable: Type.Boolean(),
}, strict);
export const acknowledgeResult = Type.Object({
  streamId: identifier,
  acknowledgedSequence: Type.Integer({ minimum: 0 }),
}, strict);
export const saveDocumentParams = Type.Object(
  {
    projectId: identifier,
    documentId: identifier,
    blocks: DocumentBlocksSchema,
    markdown: text(10_000_000),
    expectedRevision: revision,
  },
  strict,
);
export const suggestionMutation = Type.Object(
  { projectId: identifier, documentId: identifier, item: SuggestionItemSchema, expectedDocumentRevision: revision },
  strict,
);
export const healthResult = Type.Object({ respondedAt: timestamp, databaseReadable: Type.Optional(Type.Boolean()) }, strict);
