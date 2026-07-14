# Themes

ScribeAI ships its colour themes as strict YAML files in the repository-level `themes/` directory. Settings opens from the bottom of the project sidebar; choosing a theme applies it immediately and writes the selected identifier to `<userData>/settings.yaml`.

## Add a theme

Copy an existing YAML file in `themes/`, rename it to the new stable theme identifier, and change its metadata and colours. The filename (without `.yaml`) is the theme ID, so no TypeScript registry edit is needed. Themes are bundled into installed builds at build time.

Every file must contain `schema_version: 1`, a unique `display_name`, an `appearance` of `light` or `dark`, and every colour in the existing `colors` mapping. Colours accept only six- or eight-digit hex values. Unknown and missing fields are errors.

Run `npm test` and `npm run build` after adding a file. ScribeAI validates the complete catalog during the build and again on application startup. It does not skip invalid theme files.

## Canonical settings

The first launch creates exactly:

```yaml
schema_version: 1
theme: scribe-light
```

After that, `settings.yaml` is parsed strictly. An invalid schema or an unknown selected theme stops startup with an actionable error; there is no fallback theme or compatibility read.

The bundled palettes are inspired by the [Superfile theme catalog](https://superfile.dev/list/theme-list/), adapted to ScribeAI's semantic UI tokens.
