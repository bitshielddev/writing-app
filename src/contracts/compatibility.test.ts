// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  COMPATIBILITY_REGISTRY,
  DurableCompatibilityError,
  decodeVersionedJson,
  migrateJson,
  validateJsonMigrationRegistry,
} from "./compatibility";

const fixtures = JSON.parse(readFileSync(join(
  process.cwd(),
  "src/contracts/fixtures/compatibility/durable-formats.json",
), "utf8")) as Record<string, Record<string, unknown>>;
const identityMigration = [{ fromVersion: 0, toVersion: 1, migrate: (value: unknown) => value }];

describe("durable JSON compatibility", () => {
  it("requires a unique contiguous sequential migration path", () => {
    expect(() => validateJsonMigrationRegistry(identityMigration, 0, 1)).not.toThrow();
    expect(() => validateJsonMigrationRegistry([], 0, 1)).toThrow("No contiguous");
    expect(() => validateJsonMigrationRegistry([
      ...identityMigration,
      { fromVersion: 0, toVersion: 1, migrate: (value: unknown) => value },
    ], 0, 1)).toThrow("Duplicate");
    expect(migrateJson({ retained: true }, 0, 1, identityMigration)).toEqual({ retained: true });
  });

  it.each([
    ["documentBlocks", "blocks"],
    ["suggestionProjection", "state"],
    ["suggestionCommandResult", "result"],
    ["event", "event"],
  ])("reads legacy and current %s fixtures and rejects future data", (fixtureName, payloadKey) => {
    const policyKey = fixtureName === "event" ? "suggestionEvents"
      : fixtureName === "suggestionCommandResult" ? "suggestionCommands"
      : fixtureName;
    const policy = COMPATIBILITY_REGISTRY[policyKey as keyof typeof COMPATIBILITY_REGISTRY];
    /**
     * What: decodes versioned compatibility data from persisted or transported data.
     *
     * Why: the test needs a focused helper so assertions stay about the behavior under test.
     * Called when: used by compatibility when that path needs this behavior.
     */
    const decode = (value: unknown) => decodeVersionedJson({
      text: JSON.stringify(value),
      format: policy.name,
      currentVersion: policy.currentVersion,
      minimumReadableVersion: policy.minimumReadableVersion,
      legacyVersion: 0,
      payloadKey,
      migrations: identityMigration,
      recordIdentity: "fixture",
    });
    expect(decode(fixtures[fixtureName]!.legacyV0).migrated).toBe(true);
    expect(decode(fixtures[fixtureName]!.currentV1).migrated).toBe(false);
    expect(() => decode(fixtures[fixtureName]!.futureV2)).toThrowError(
      expect.objectContaining<Partial<DurableCompatibilityError>>({
        code: "DURABLE_FORMAT_TOO_NEW",
      }),
    );
  });
});
