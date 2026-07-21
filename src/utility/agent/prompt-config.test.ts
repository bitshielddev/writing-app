// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import {
  loadAgentPromptBootstrap,
  loadAgentPromptConfiguration,
  renderReviewCyclePrompt,
  writeAgentPromptBootstrap,
} from "./prompt-config";

const SYSTEM_PROMPT = "You are Scribe's autonomous writing partner. Treat the BlockNote document returned by read_document and every file in sources/ as read-only. The blocks field is the canonical persisted BlockNote document and preserves structure such as tables and nested children; plainTextBlocks is only a same-revision helper for anchoring supported single-block text edits. Never edit project files. Publish proposed changes only through Scribe suggestion tools. Call read_document before creating or updating edit suggestions, and anchor edits to one returned plain-text block with sourceDocumentRevision, sourceBlockId, sourceStart, sourceEnd, and exact sourceText. For changes spanning multiple blocks, tables, nested structure, or structural edits, create a note suggestion instead of an edit. Cite the exact source filename for sourced claims. Call wait_for_changes when useful work for the current durable revision is exhausted.";
const REVIEW_PROMPT = "Review the durable Scribe project revision {{project_revision}} (document revision {{document_revision}}). Call read_document for the current BlockNote document and read relevant Markdown files in sources/. Manage only concrete, high-value suggestions. If no useful work remains for this revision, call wait_for_changes.";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function temporaryExperience() {
  const root = await mkdtemp(join(tmpdir(), "scribe-agent-prompts-"));
  directories.push(root);
  await mkdir(join(root, "prompts"));
  return root;
}

async function writeExperience(
  root: string,
  promptSource: string,
  promptFile = "prompts/default.yaml",
) {
  await writeFile(
    join(root, "config.yaml"),
    `schema_version: 1\nprompt_file: ${promptFile}\n`,
  );
  await writeFile(join(root, promptFile), promptSource);
}

describe("agent prompt configuration", () => {
  it("loads the bundled prompt set without changing the current prompt text", async () => {
    const prompts = await loadAgentPromptConfiguration(resolve("experience"));

    expect(prompts).toEqual({
      systemAppend: SYSTEM_PROMPT,
      reviewCycle: REVIEW_PROMPT,
      promptFile: "prompts/default.yaml",
    });
  });

  it("selects a multiline YAML prompt file and renders revision placeholders", async () => {
    const root = await temporaryExperience();
    await writeExperience(root, [
      "schema_version: 1",
      "system_append: |-",
      "  System line one.",
      "  System line two.",
      "review_cycle: >-",
      "  Review project {{project_revision}} at",
      "  document {{document_revision}}.",
      "",
    ].join("\n"));

    const prompts = await loadAgentPromptConfiguration(root);

    expect(prompts.systemAppend).toBe("System line one.\nSystem line two.");
    expect(renderReviewCyclePrompt(prompts.reviewCycle, {
      projectRevision: 12,
      documentRevision: 7,
    })).toBe("Review project 12 at document 7.");
  });

  it("rejects unknown placeholders", async () => {
    const root = await temporaryExperience();
    await writeExperience(root, [
      "schema_version: 1",
      "system_append: System",
      "review_cycle: Review {{document_title}}",
      "",
    ].join("\n"));

    await expect(loadAgentPromptConfiguration(root)).rejects.toThrow(
      "unknown placeholder: {{document_title}}",
    );
  });

  it("rejects malformed placeholders", async () => {
    const root = await temporaryExperience();
    await writeExperience(root, [
      "schema_version: 1",
      "system_append: System",
      "review_cycle: Review {{project_revision",
      "",
    ].join("\n"));

    await expect(loadAgentPromptConfiguration(root)).rejects.toThrow(
      "review_cycle contains a malformed placeholder",
    );
  });

  it("rejects prompt paths outside the experience directory", async () => {
    const root = await temporaryExperience();
    const outside = join(root, "..", `${basename(root)}-outside.yaml`);
    await writeFile(outside, "schema_version: 1\nsystem_append: System\nreview_cycle: Review\n");
    directories.push(outside);
    await writeFile(
      join(root, "config.yaml"),
      `schema_version: 1\nprompt_file: ../${basename(outside)}\n`,
    );

    await expect(loadAgentPromptConfiguration(root)).rejects.toThrow(
      "prompt_file must stay inside the experience directory",
    );
  });

  it("captures invalid launch configuration without making the snapshot unreadable", async () => {
    const root = await temporaryExperience();
    const snapshot = join(root, "launch.json");
    await writeFile(join(root, "config.yaml"), "schema_version: 1\n");

    await writeAgentPromptBootstrap(root, snapshot);

    await expect(loadAgentPromptBootstrap(snapshot)).rejects.toThrow(
      "Agent prompt configuration is invalid: experience/config.yaml is invalid",
    );
  });

  it("round-trips a valid immutable launch snapshot", async () => {
    const root = await temporaryExperience();
    const snapshot = join(root, "launch.json");
    await writeExperience(root, [
      "schema_version: 1",
      "system_append: System",
      "review_cycle: Review {{project_revision}}/{{document_revision}}",
      "",
    ].join("\n"));

    await writeAgentPromptBootstrap(root, snapshot);

    await expect(loadAgentPromptBootstrap(snapshot)).resolves.toEqual({
      systemAppend: "System",
      reviewCycle: "Review {{project_revision}}/{{document_revision}}",
      promptFile: "prompts/default.yaml",
    });
  });
});
