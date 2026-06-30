// @vitest-environment node

import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  closeStorageForTest,
  handleStorageRequest,
} from "./storage";
import type { WorkspaceSnapshot } from "../src/shared/desktop";
import type { TextSuggestion } from "../src/suggestions/types";

describe("desktop storage service", () => {
  afterAll(() => closeStorageForTest());

  it("bootstraps and saves the current document snapshot", async () => {
    const initial = await handleStorageRequest(
      "hydrate",
    ) as WorkspaceSnapshot;
    expect(initial.document.blocks).toHaveLength(1);
    expect(initial.document.revision).toBe(0);

    const saved = await handleStorageRequest("document.save", {
      documentId: initial.document.id,
      expectedRevision: initial.document.revision,
      blocks: [{ type: "paragraph", content: "Persisted draft" }],
    }) as WorkspaceSnapshot["document"];

    expect(saved.revision).toBe(1);
    expect(saved.blocks).toEqual([
      { type: "paragraph", content: "Persisted draft" },
    ]);
  });

  it("persists agent suggestions and emits them into hydration state", async () => {
    const snapshot = await handleStorageRequest(
      "hydrate",
    ) as WorkspaceSnapshot;
    const item: TextSuggestion = {
      id: "agent-suggestion",
      dedupeKey: "agent-suggestion",
      kind: "snippet",
      title: "Tighten the opening",
      summary: "A more direct opening sentence.",
      body: "This removes the introductory hedge.",
      insertText: "Start with the central claim.",
      sourceLabels: ["Untitled Draft"],
      createdAt: 10,
    };

    await handleStorageRequest("agent.suggestion.create", {
      item,
      expectedDocumentRevision: snapshot.document.revision,
    });
    const hydrated = await handleStorageRequest(
      "hydrate",
    ) as WorkspaceSnapshot;

    expect(hydrated.suggestions.entries[0]?.item).toEqual(item);
    expect(hydrated.suggestions.seenKeys[item.dedupeKey]).toBe(true);
  });

  it("records complete transcript events for a run", async () => {
    const seed = await handleStorageRequest("agent.seed");
    await handleStorageRequest("agent.run.start", {
      id: "run-1",
      seed,
      provider: "test",
      model: "test-model",
    });
    await handleStorageRequest("agent.run.transcript", {
      runId: "run-1",
      eventType: "message_end",
      payload: { message: "complete" },
    });
    await expect(
      handleStorageRequest("agent.run.finish", {
        runId: "run-1",
        status: "completed",
      }),
    ).resolves.toBeUndefined();
  });

  it("imports searchable project source text", async () => {
    const directory = await mkdtemp(join(tmpdir(), "scribe-source-"));
    const path = join(directory, "research.md");
    await writeFile(path, "A distinctive source phrase about durable writing.");
    try {
      const source = await handleStorageRequest("source.import", { path }) as {
        title: string;
        extractedCharacters: number;
      };
      const matches = await handleStorageRequest("agent.content.search", {
        query: "distinctive source phrase",
      }) as Array<{ title: string }>;

      expect(source.title).toBe("research.md");
      expect(source.extractedCharacters).toBeGreaterThan(20);
      expect(matches).toEqual(
        expect.arrayContaining([expect.objectContaining({ title: "research.md" })]),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
