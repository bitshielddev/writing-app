import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import electron from "vite-plugin-electron/simple";
import { notBundle } from "vite-plugin-electron/plugin";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const nodeTestFiles = [
  "src/components/workspacePins/geometry.test.ts",
  "src/dev/mockSuggestions/mockSuggestionDraft.test.ts",
  "src/keybindings/sequenceMatcher.test.ts",
  "src/shared/contracts.test.ts",
  "src/suggestions/inbox.test.ts",
  "src/suggestions/schema.test.ts",
  "src/suggestions/state.test.ts",
];

function cleanElectronOutput(): Plugin {
  return {
    name: "clean-electron-output",
    apply: "build",
    configResolved() {
      rmSync(fileURLToPath(new URL("./dist-electron", import.meta.url)), {
        recursive: true,
        force: true,
      });
    },
  };
}

function bundleMetadata(): Plugin {
  const projectRoot = fileURLToPath(new URL(".", import.meta.url)).replaceAll(
    "\\",
    "/",
  );
  return {
    name: "bundle-metadata",
    apply: "build",
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle)
        .filter((output) => output.type === "chunk")
        .map((chunk) => ({
          file: chunk.fileName,
          entry: chunk.isEntry,
          dynamicEntry: chunk.isDynamicEntry,
          imports: [...chunk.imports].sort(),
          dynamicImports: [...chunk.dynamicImports].sort(),
          modules: Object.entries(chunk.modules)
            .map(([id, details]) => ({
              id: id.replaceAll("\\", "/").replace(`${projectRoot}/`, ""),
              renderedBytes: details.renderedLength,
            }))
            .sort((left, right) =>
              right.renderedBytes - left.renderedBytes ||
              left.id.localeCompare(right.id),
            ),
        }))
        .sort((left, right) => left.file.localeCompare(right.file));

      this.emitFile({
        type: "asset",
        fileName: ".vite/bundle-metadata.json",
        source: `${JSON.stringify({ version: 1, chunks }, null, 2)}\n`,
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [
    cleanElectronOutput(),
    bundleMetadata(),
    react(),
    tailwindcss(),
    electron({
      main: {
        entry: {
          main: "desktop/main.ts",
          storage: "desktop/storage.ts",
          agent: "desktop/agent.ts",
        },
        vite: {
          plugins: [notBundle({ filter: /^(?![./])/ })],
        },
      },
      preload: {
        input: fileURLToPath(new URL("./desktop/preload.ts", import.meta.url)),
        vite: {
          build: {
            rolldownOptions: {
              output: {
                entryFileNames: "preload.cjs",
              },
            },
          },
        },
      },
    }),
  ],
  build: {
    manifest: true,
  },
  test: {
    // Keep local test runs responsive instead of saturating every CPU core.
    maxWorkers: "50%",
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: [
            "desktop/**/*.test.ts",
            "scripts/**/*.test.mjs",
            ...nodeTestFiles,
          ],
          setupFiles: [],
        },
      },
      {
        extends: true,
        test: {
          name: "renderer",
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: nodeTestFiles,
          setupFiles: "./src/test/setup.ts",
        },
      },
    ],
  },
});
