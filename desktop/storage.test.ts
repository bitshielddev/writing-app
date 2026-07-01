// @vitest-environment node

import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  closeStorageForTest,
  getWorkspacePathsForTest,
  handleStorageRequest,
} from "./storage";
import type { SourceSnapshot, WorkspaceSnapshot } from "../src/shared/desktop";
import type { TextSuggestion } from "../src/suggestions/types";

describe("desktop storage service", () => {
  afterAll(async () => closeStorageForTest());

  it("saves block JSON and Markdown before returning the durable revision", async () => {
    const initial = await handleStorageRequest("hydrate") as WorkspaceSnapshot;
    const saved = await handleStorageRequest("document.save", {
      documentId: initial.document.id,
      expectedRevision: initial.document.revision,
      blocks: [{ type: "paragraph", content: "Persisted draft" }],
      markdown: "Persisted draft\n",
    }) as WorkspaceSnapshot["document"];

    expect(saved.revision).toBe(initial.document.revision + 1);
    expect(saved.markdown).toBe("Persisted draft\n");
    expect(await readFile(getWorkspacePathsForTest().draftPath, "utf8"))
      .toBe("Persisted draft\n");
  });

  it("repairs a damaged draft mirror from SQLite", async () => {
    const { draftPath } = getWorkspacePathsForTest();
    await writeFile(draftPath, "damaged mirror", "utf8");
    const result = await handleStorageRequest("workspace.repair") as { repaired: boolean };
    const snapshot = await handleStorageRequest("hydrate") as WorkspaceSnapshot;

    expect(result.repaired).toBe(true);
    expect(await readFile(draftPath, "utf8")).toBe(snapshot.document.markdown);
  });

  it("persists suggestions and rejects stale mutations", async () => {
    const snapshot = await handleStorageRequest("hydrate") as WorkspaceSnapshot;
    const item: TextSuggestion = {
      id: "agent-suggestion",
      dedupeKey: "agent-suggestion",
      kind: "snippet",
      title: "Tighten the opening",
      summary: "A more direct opening sentence.",
      body: "This removes the introductory hedge.",
      insertText: "Start with the central claim.",
      sourceLabels: ["draft.md"],
      createdAt: 10,
    };

    await expect(handleStorageRequest("agent.suggestion.create", {
      item,
      expectedDocumentRevision: snapshot.document.revision - 1,
    })).rejects.toThrow("STALE_SUGGESTION_REVISION");
    await handleStorageRequest("agent.suggestion.create", {
      item,
      expectedDocumentRevision: snapshot.document.revision,
    });
    const hydrated = await handleStorageRequest("hydrate") as WorkspaceSnapshot;
    expect(hydrated.suggestions.entries[0]?.item).toEqual(item);
  });

  it("imports only UTF-8 Markdown with readable collision-safe filenames", async () => {
    const directory = await mkdtemp(join(tmpdir(), "scribe-source-"));
    const path = join(directory, "research notes.md");
    await writeFile(path, "A durable Markdown source.");
    try {
      const first = await handleStorageRequest("source.import", { path }) as SourceSnapshot;
      const second = await handleStorageRequest("source.import", { path }) as SourceSnapshot;
      expect(first.title).toBe("research notes.md");
      expect(second.title).toBe("research notes (2).md");
      expect(await readFile(second.storagePath, "utf8")).toBe("A durable Markdown source.");
      expect(first.bytes).toBeGreaterThan(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects unsupported extensions and invalid UTF-8", async () => {
    const directory = await mkdtemp(join(tmpdir(), "scribe-source-invalid-"));
    const textPath = join(directory, "notes.txt");
    const invalidPath = join(directory, "invalid.md");
    await writeFile(textPath, "plain text");
    await writeFile(invalidPath, Buffer.from([0xc3, 0x28]));
    try {
      await expect(handleStorageRequest("source.import", { path: textPath }))
        .rejects.toThrow("Only .md and .markdown");
      await expect(handleStorageRequest("source.import", { path: invalidPath }))
        .rejects.toThrow("valid UTF-8");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
