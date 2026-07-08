import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  budgetViolations,
  collectBundleStats,
  findInitialFiles,
  productionViolations,
} from "./bundle-budget.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("renderer bundle budget", () => {
  it("traverses static manifest imports without including lazy chunks", () => {
    const manifest = {
      "src/main.tsx": {
        file: "assets/main.js",
        isEntry: true,
        imports: ["_shared.js"],
        dynamicImports: ["src/lazy.tsx"],
      },
      "_shared.js": { file: "assets/shared.js" },
      "src/lazy.tsx": { file: "assets/lazy.js", isDynamicEntry: true },
    };
    expect([...findInitialFiles(manifest)].sort()).toEqual([
      "assets/main.js",
      "assets/shared.js",
    ]);
  });

  it("measures initial and lazy JavaScript from build metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "scribe-bundle-"));
    temporaryDirectories.push(directory);
    await mkdir(join(directory, ".vite"));
    await mkdir(join(directory, "assets"));
    await writeFile(
      join(directory, ".vite/manifest.json"),
      JSON.stringify({
        "src/main.tsx": {
          file: "assets/main.js",
          isEntry: true,
          dynamicImports: ["src/lazy.tsx"],
        },
        "src/lazy.tsx": {
          file: "assets/lazy.js",
          isDynamicEntry: true,
        },
      }),
    );
    await writeFile(
      join(directory, ".vite/bundle-metadata.json"),
      JSON.stringify({
        chunks: [
          { file: "assets/main.js", entry: true, imports: [], modules: [] },
          { file: "assets/lazy.js", dynamicEntry: true, imports: [], modules: [] },
        ],
      }),
    );
    await writeFile(join(directory, "assets/main.js"), "a".repeat(10));
    await writeFile(join(directory, "assets/lazy.js"), "b".repeat(7));

    const stats = await collectBundleStats(directory);
    expect(stats.initial.rawBytes).toBe(10);
    expect(stats.lazy.rawBytes).toBe(7);
  });

  it("passes at limits and fails fixtures one byte over raw and gzip limits", () => {
    const stats = {
      entry: { rawBytes: 90, gzipBytes: 45, brotliBytes: 35 },
      initial: { rawBytes: 100, gzipBytes: 50, brotliBytes: 40 },
    };
    expect(
      budgetViolations(stats, {
        entry: { rawBytes: 90, gzipBytes: 45 },
        initial: { rawBytes: 100, gzipBytes: 50 },
      }),
    ).toEqual([]);
    expect(
      budgetViolations(stats, {
        entry: { rawBytes: 90, gzipBytes: 45 },
        initial: { rawBytes: 99, gzipBytes: 50 },
      }).map(({ label }) => label),
    ).toEqual(["initial raw"]);
    expect(
      budgetViolations(stats, {
        entry: { rawBytes: 90, gzipBytes: 45 },
        initial: { rawBytes: 100, gzipBytes: 49 },
      }).map(({ label }) => label),
    ).toEqual(["initial gzip"]);
  });

  it("rejects Mermaid in the initial graph", () => {
    expect(
      productionViolations({
        initialFiles: ["assets/main.js"],
        metadata: {
          chunks: [
            {
              file: "assets/main.js",
              modules: [
                { id: "/repo/node_modules/mermaid/dist/mermaid.js" },
              ],
            },
          ],
        },
      }),
    ).toHaveLength(1);
  });
});
