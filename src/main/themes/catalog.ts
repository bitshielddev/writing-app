import { constants } from "node:fs";
import { access, readFile, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { parse, stringify } from "yaml";
import { Type } from "typebox";
import { Value } from "typebox/value";

import type { ThemeCatalog, ThemeDefinition } from "../../contracts/desktop-bridge.js";
import { ThemeDefinitionSchema } from "../../contracts/operations/renderer.js";
import { strict } from "../../contracts/base.js";

const bundledThemeFiles = import.meta.glob("../../../themes/*.yaml", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const SettingsSchema = Type.Object({
  schema_version: Type.Literal(1),
  theme: Type.String({ minLength: 1 }),
}, strict);

type Settings = { schema_version: 1; theme: string };

function validationFailure(subject: string, errors: Iterable<{ path?: string; message?: string }>) {
  const first = [...errors][0];
  const location = first?.path || "root";
  throw new Error(`${subject} is invalid at ${location}: ${first?.message ?? "schema mismatch"}`);
}

export function loadBundledThemes(files: Record<string, string> = bundledThemeFiles): ThemeDefinition[] {
  const themes = Object.entries(files).map(([path, source]) => {
    const id = basename(path, ".yaml");
    let document: unknown;
    try {
      document = parse(source, { uniqueKeys: true });
    } catch (error) {
      throw new Error(`Theme ${id} is not valid YAML: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    const theme = { id, ...(document as object) };
    if (!Value.Check(ThemeDefinitionSchema, theme)) {
      validationFailure(`Theme ${id}`, Value.Errors(ThemeDefinitionSchema, theme));
    }
    return theme as ThemeDefinition;
  });
  const ids = new Set(themes.map((theme) => theme.id));
  if (ids.size !== themes.length) throw new Error("Theme identifiers must be unique");
  if (!ids.has("scribe-light")) throw new Error("Canonical theme scribe-light is missing");
  return themes.sort((left, right) => left.display_name.localeCompare(right.display_name));
}

async function atomicWrite(path: string, contents: string) {
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, contents, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
}

export class ThemeService {
  readonly themes: ThemeDefinition[];
  readonly settingsPath: string;
  private activeThemeId = "";

  constructor(userDataPath: string, themes = loadBundledThemes()) {
    this.themes = themes;
    this.settingsPath = join(userDataPath, "settings.yaml");
  }

  async initialize() {
    try {
      await access(this.settingsPath, constants.F_OK);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await atomicWrite(this.settingsPath, stringify({ schema_version: 1, theme: "scribe-light" }));
    }
    const source = await readFile(this.settingsPath, "utf8");
    let settings: unknown;
    try {
      settings = parse(source, { uniqueKeys: true });
    } catch (error) {
      throw new Error(`settings.yaml is not valid YAML: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    if (!Value.Check(SettingsSchema, settings)) {
      validationFailure("settings.yaml", Value.Errors(SettingsSchema, settings));
    }
    const selected = settings as Settings;
    if (!this.themes.some((theme) => theme.id === selected.theme)) {
      throw new Error(`settings.yaml selects unknown theme: ${selected.theme}`);
    }
    this.activeThemeId = selected.theme;
  }

  catalog(): ThemeCatalog {
    if (!this.activeThemeId) throw new Error("Theme service has not been initialized");
    return { activeThemeId: this.activeThemeId, themes: this.themes };
  }

  async select(themeId: string): Promise<ThemeCatalog> {
    if (!this.themes.some((theme) => theme.id === themeId)) {
      throw new Error(`Unknown theme: ${themeId}`);
    }
    await atomicWrite(this.settingsPath, stringify({ schema_version: 1, theme: themeId }));
    this.activeThemeId = themeId;
    return this.catalog();
  }
}
