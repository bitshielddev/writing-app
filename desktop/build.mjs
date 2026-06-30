import { build } from "esbuild";

const shared = {
  bundle: true,
  platform: "node",
  sourcemap: true,
  packages: "external",
};

await build({
  ...shared,
  entryPoints: ["desktop/main.ts", "desktop/storage.ts", "desktop/agent.ts"],
  format: "esm",
  outdir: "dist-electron",
});

await build({
  ...shared,
  entryPoints: ["desktop/preload.ts"],
  format: "cjs",
  outfile: "dist-electron/preload.cjs",
});
