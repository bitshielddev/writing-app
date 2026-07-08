// @vitest-environment node

import { describe, expect, it } from "vitest";

import { createEmptySuggestionState } from "../../src/suggestions/state";
import type { TextSuggestion } from "../../src/domain/suggestions/schema.js";
import {
  applySuggestionFact,
  decideSuggestionCommand,
  type SuggestionProjectionView,
} from "./suggestion-persistence";
import { suggestionProjectionChecksum } from "../storage/projection-checksum";

const item: TextSuggestion = {
  id: "suggestion-1", dedupeKey: "dedupe-1", kind: "snippet", title: "Opening",
  summary: "Summary", body: "Body", insertText: "Text", sourceLabels: [], createdAt: 1,
};

describe("command-driven suggestion persistence", () => {
  it("decides facts and rebuilds the same projection without I/O", () => {
    let projection: SuggestionProjectionView = {
      state: createEmptySuggestionState(), revision: 0, coveredThroughSequence: 0,
    };
    const commands = [
      { type: "publish" as const, item },
      { type: "markViewed" as const, suggestionId: item.id },
      { type: "pin" as const, suggestionId: item.id, pinnedAt: 10 },
      { type: "workspace.place" as const, suggestionId: item.id,
        rect: { x: 1, y: 2, width: 300, height: 200 } },
      { type: "workspace.geometry" as const, suggestionId: item.id,
        rect: { x: 5, y: 6, width: 320, height: 210 } },
    ];

    for (const command of commands) {
      const decision = decideSuggestionCommand(projection.state, command);
      expect(decision.status).toBe("changed");
      if (decision.status !== "changed") throw new Error("expected changed decision");
      for (const fact of decision.facts) {
        projection = applySuggestionFact(projection, {
          sequence: projection.coveredThroughSequence + 1, fact,
        });
      }
    }

    expect(projection).toMatchObject({ revision: 5, coveredThroughSequence: 5 });
    expect(projection.state.workspacePins[0]).toMatchObject({ x: 5, y: 6, width: 320, height: 210 });
    expect(suggestionProjectionChecksum(projection.state, 5)).toHaveLength(64);
  });

  it("is idempotent for covered events and rejects sequence gaps", () => {
    const projection: SuggestionProjectionView = {
      state: createEmptySuggestionState(), revision: 0, coveredThroughSequence: 0,
    };
    const fact = { type: "suggestion.published" as const, version: 1 as const, item };
    const applied = applySuggestionFact(projection, { sequence: 1, fact });
    expect(applySuggestionFact(applied, { sequence: 1, fact })).toBe(applied);
    expect(() => applySuggestionFact(projection, { sequence: 2, fact }))
      .toThrow("SUGGESTION_EVENT_SEQUENCE_GAP");
  });

  it("rejects invalid intent without producing a fact", () => {
    expect(decideSuggestionCommand(createEmptySuggestionState(), {
      type: "dismiss", suggestionId: "missing",
    })).toEqual({ status: "rejected", facts: [], reason: "Suggestion is not dismissible" });
  });
});
