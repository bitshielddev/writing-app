# Renderer bundle and startup performance

## Reproduce the bundle measurement

Use Node.js 24 and the locked dependencies:

```sh
npm ci
npm run build
npm run bundle:check
npm run bundle:report
```

The production build emits `.vite/manifest.json` and deterministic
`.vite/bundle-metadata.json`. The report follows static manifest imports to
distinguish JavaScript required at first paint from dynamic chunks, compresses
the emitted bytes with Node's gzip and Brotli implementations, and attributes
the five largest chunks to their source modules. The committed budget has 5%
headroom over the final static initial graph. Both the entry chunk and total
initial graph are enforced.

## Bundle measurements

| Measurement | Raw bytes | gzip bytes | Brotli bytes |
| --- | ---: | ---: | ---: |
| Review baseline (entry) | 1,297,670 | 388,430 | not recorded |
| Current pre-change baseline (entry) | 1,300,755 | 383,971 | 320,278 |
| Final entry | 1,290,741 | 381,238 | 318,073 |
| Final initial graph | 1,299,334 | 384,667 | 321,121 |
| Final lazy JavaScript | 3,883,813 | 1,048,824 | 889,071 |

After the suggestion-controller consolidation, the current entry is 1,362,416
raw bytes (401,509 gzip) and the initial graph is 1,371,009 raw bytes (404,938
gzip). The committed budget retains 5% headroom over these measurements.

The keyboard shortcut dialog moved 3,580 raw bytes (1,510 gzip) into a lazy
chunk and caused Vite to extract 7,890 raw bytes of shared JSX runtime. The
entry reduction is 10,014 raw bytes and 2,733 gzip bytes. The full initial graph
is 1,421 raw bytes smaller than the former entry and 696 gzip bytes larger; the
gzip movement is the cost of the new compression boundary. The dialog is
prefetched only after the editor-ready marker, preserving immediate subsequent
access without adding work before editor readiness.

The largest final chunks are the 1,290,741-byte application entry and four lazy
Mermaid dependencies: the 662,650-byte Mermaid chunk, 435,383-byte Cytoscape
chunk, 429,053-byte emoji-data chunk, and 258,881-byte KaTeX chunk. BlockNote remains
in the entry because it is the primary writing surface. Mermaid is absent from
the initial graph and is loaded only by mind-map presentation. The attribution
report shows no Electron or Node runtime modules in renderer output and no
duplicate React copies.

## Startup markers

The renderer records content-free User Timing marks:

- `scribe:bootstrap` when the renderer module starts;
- `scribe:react-mounted` after the application root commits;
- `scribe:hydration-complete` after persisted workspace state is applied;
- `scribe:editor-ready` on the first animation frame after the editor mounts.

Cold-start timing must be collected on the same reference machine from a clean
Electron profile. Record at least five launches and report the median for the
workspace-shell (`react-mounted - bootstrap`) and editor-ready
(`editor-ready - bootstrap`) intervals. CI does not enforce wall-clock startup
because hosted runner variance would make that signal unreliable; the marks
make the local procedure reproducible.

Run `npm run startup:measure` after `npm run build`. On the current Linux
reference environment (Node.js 24, Electron 42.5.1), five isolated clean-profile
launches produced medians of **561.9 ms** to the workspace shell, **1,519.4 ms**
to hydration completion, and **567.6 ms** to editor readiness. Individual runs
are printed by the harness so variance and outliers remain visible.
