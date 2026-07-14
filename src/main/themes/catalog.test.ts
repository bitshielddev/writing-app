import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { loadBundledThemes, ThemeService } from "./catalog";

const directories: string[] = [];
async function profile() {
  const path = await mkdtemp(join(tmpdir(), "scribe-theme-test-"));
  directories.push(path);
  return path;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("theme catalog", () => {
  it("strictly validates every bundled YAML theme", () => {
    const themes = loadBundledThemes();
    expect(themes).toHaveLength(22);
    expect(themes.map((theme) => theme.id)).toContain("scribe-light");
    expect(themes.map((theme) => theme.id)).toContain("tokyonight");
  });

  it("creates canonical settings on a new profile and persists selections", async () => {
    const path = await profile();
    const service = new ThemeService(path);
    await service.initialize();
    expect(service.catalog().activeThemeId).toBe("scribe-light");
    expect(await readFile(join(path, "settings.yaml"), "utf8")).toContain("theme: scribe-light");
    await service.select("nord");
    expect(service.catalog().activeThemeId).toBe("nord");
    expect(await readFile(join(path, "settings.yaml"), "utf8")).toContain("theme: nord");
  });

  it("rejects invalid settings and unknown selected themes", async () => {
    const path = await profile();
    await writeFile(join(path, "settings.yaml"), "schema_version: 1\ntheme: missing\n", "utf8");
    await expect(new ThemeService(path).initialize()).rejects.toThrow("unknown theme");
    await writeFile(join(path, "settings.yaml"), "schema_version: 1\ntheme: nord\nunexpected: true\n", "utf8");
    await expect(new ThemeService(path).initialize()).rejects.toThrow("settings.yaml is invalid");
  });

  it("rejects malformed theme files instead of skipping them", () => {
    expect(() => loadBundledThemes({ "/themes/broken.yaml": "schema_version: 1\n" }))
      .toThrow("Theme broken is invalid");
  });
});
