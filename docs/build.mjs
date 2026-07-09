import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { marked, Renderer } from "marked";

const docsDirectory = path.dirname(fileURLToPath(import.meta.url));
const siteDirectory = path.join(docsDirectory, "html");
const staticAssetsDirectory = path.join(docsDirectory, "assets");

const pages = [
  {
    source: "README.md",
    output: "index.html",
    title: "ScribeAI developer documentation",
    shortTitle: "Overview",
    category: "Get oriented",
    number: "00",
    description:
      "A practical map of the writing workspace, its current capabilities, and the fastest route into the codebase.",
    accent: "violet",
  },
  {
    source: "getting-started.md",
    output: "getting-started.html",
    title: "Getting started",
    shortTitle: "Getting started",
    category: "Get oriented",
    number: "01",
    description:
      "Install, run, inspect, and troubleshoot the project from a clean checkout.",
    accent: "blue",
  },
  {
    source: "architecture.md",
    output: "architecture.html",
    title: "Architecture",
    shortTitle: "Architecture",
    category: "Get oriented",
    number: "02",
    description:
      "Understand browser and Electron boundaries, state ownership, data direction, and module responsibilities.",
    accent: "cyan",
  },
  {
    source: "architecture-review.md",
    output: "architecture-review.html",
    title: "Architecture review",
    shortTitle: "Architecture review",
    category: "Get oriented",
    number: "03",
    description:
      "Review the current architecture, its risks, and a phased path for changing it safely.",
    accent: "amber",
  },
  {
    source: "desktop-runtime.md",
    output: "desktop-runtime.html",
    title: "Desktop persistence and Pi runtime",
    shortTitle: "Desktop & Pi",
    category: "Build internals",
    number: "04",
    description:
      "Trace Electron processes, SQLite persistence, source import, events, and background Pi observations.",
    accent: "cyan",
  },
  {
    source: "editor-and-suggestions.md",
    output: "editor-and-suggestions.html",
    title: "Editor and suggestion system",
    shortTitle: "Editor & suggestions",
    category: "Build internals",
    number: "05",
    description:
      "Trace agent context, feed events, inbox transitions, editable previews, and workspace pins end to end.",
    accent: "amber",
  },
  {
    source: "ui-and-accessibility.md",
    output: "ui-and-accessibility.html",
    title: "UI and accessibility",
    shortTitle: "UI & accessibility",
    category: "Build internals",
    number: "06",
    description:
      "Work confidently with responsive panels, editor layout, keyboard input, focus, and visual conventions.",
    accent: "rose",
  },
  {
    source: "testing-and-quality.md",
    output: "testing-and-quality.html",
    title: "Testing and quality",
    shortTitle: "Testing & quality",
    category: "Ship safely",
    number: "07",
    description:
      "Know what the automated suite protects, where browser checks are required, and what to run before handoff.",
    accent: "green",
  },
  {
    source: "compatibility.md",
    output: "compatibility.html",
    title: "Durable-format and process compatibility",
    shortTitle: "Compatibility",
    category: "Ship safely",
    number: "08",
    description:
      "Version, migrate, reject, preserve, and recover durable formats and packaged process protocols.",
    accent: "blue",
  },
  {
    source: "extension-guide.md",
    output: "extension-guide.html",
    title: "Extension guide",
    shortTitle: "Extension guide",
    category: "Ship safely",
    number: "09",
    description:
      "Use the existing seams to add a real agent, persistence, suggestion kinds, editor blocks, and application actions.",
    accent: "violet",
  },
];

const groups = ["Get oriented", "Build internals", "Ship safely"];

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function stripMarkdown(value) {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_~#>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value) {
  return stripMarkdown(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "section";
}

function icon(name, className = "") {
  const paths = {
    search:
      '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.4-3.4"></path>',
    sun:
      '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"></path>',
    moon: '<path d="M21 12.8A8.5 8.5 0 1 1 11.2 3 6.8 6.8 0 0 0 21 12.8Z"></path>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"></path>',
    close: '<path d="m6 6 12 12M18 6 6 18"></path>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"></path>',
    external:
      '<path d="M15 4h5v5M10 14 20 4"></path><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"></path>',
    check: '<path d="m5 12 4 4L19 6"></path>',
    copy: '<rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"></path>',
  };
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}

function renderArchitectureMap(source) {
  return `<figure class="diagram diagram--architecture" aria-labelledby="architecture-map-title">
    <figcaption id="architecture-map-title">
      <span class="diagram__eyebrow">System map</span>
      <strong>State moves in one direction through explicit owners</strong>
    </figcaption>
    <div class="architecture-flow">
      <div class="diagram-node diagram-node--person"><span>User</span></div>
      <span class="diagram-arrow" aria-hidden="true">↓</span>
      <div class="diagram-node diagram-node--primary"><small>Composition</small><span>App + workspace controller</span></div>
      <div class="diagram-branches" aria-label="App connections">
        <div class="diagram-branch"><span class="diagram-line" aria-hidden="true"></span><div class="diagram-node"><small>Document</small><span>BlockNote editor</span></div></div>
        <div class="diagram-branch"><span class="diagram-line" aria-hidden="true"></span><div class="diagram-node"><small>Context</small><span>Accepted snapshot</span></div></div>
        <div class="diagram-branch"><span class="diagram-line" aria-hidden="true"></span><div class="diagram-node"><small>Preference</small><span>Column widths</span></div></div>
      </div>
      <div class="diagram-pipeline" aria-label="Suggestion event pipeline">
        <div class="diagram-node"><span>Agent context</span></div><span class="diagram-arrow" aria-hidden="true">→</span>
        <div class="diagram-node"><span>Controller feed</span></div><span class="diagram-arrow" aria-hidden="true">→</span>
        <div class="diagram-node diagram-node--primary"><span>Inbox reducer</span></div><span class="diagram-arrow" aria-hidden="true">→</span>
        <div class="diagram-node"><span>Dock & cards</span></div>
      </div>
    </div>
    <details class="diagram-source"><summary>View Mermaid source</summary><pre><code>${escapeHtml(source)}</code></pre></details>
  </figure>`;
}

function renderProcessMap(source) {
  return `<figure class="diagram diagram--architecture" aria-labelledby="process-map-title">
    <figcaption id="process-map-title">
      <span class="diagram__eyebrow">Process topology</span>
      <strong>Electron separates interface, coordination, storage, and agent work</strong>
    </figcaption>
    <div class="architecture-flow">
      <div class="diagram-node diagram-node--primary"><small>Coordinator</small><span>Electron main process</span></div>
      <div class="diagram-branches" aria-label="Processes coordinated by Electron main">
        <div class="diagram-branch"><span class="diagram-line" aria-hidden="true"></span><div class="diagram-node"><small>Persistence</small><span>Storage utility process</span></div></div>
        <div class="diagram-branch"><span class="diagram-line" aria-hidden="true"></span><div class="diagram-node"><small>Writing agent</small><span>Agent utility process</span></div></div>
        <div class="diagram-branch"><span class="diagram-line" aria-hidden="true"></span><div class="diagram-node"><small>Restricted IPC</small><span>Isolated preload bridge</span></div></div>
      </div>
      <div class="diagram-pipeline" aria-label="Renderer request path">
        <div class="diagram-node"><span>React renderer</span></div><span class="diagram-arrow" aria-hidden="true">↔</span>
        <div class="diagram-node"><span>Preload bridge</span></div><span class="diagram-arrow" aria-hidden="true">↔</span>
        <div class="diagram-node diagram-node--primary"><span>Electron main</span></div>
      </div>
      <p class="diagram-note">Agent storage requests are forwarded through main. Durable storage events return through main to the renderer and agent.</p>
    </div>
    <details class="diagram-source"><summary>View Mermaid source</summary><pre><code>${escapeHtml(source)}</code></pre></details>
  </figure>`;
}

function renderTimeline(source, kind) {
  const architectureSteps = [
    ["01", "Render", "main.tsx mounts App inside StrictMode."],
    ["02", "Create", "App creates the schema-backed editor and layout controller."],
    ["03", "Connect", "The workspace controller creates the stable desktop feed and inbox."],
    ["04", "Hydrate", "The controller restores accepted blocks and persisted workspace state."],
    ["05", "Subscribe", "Suggestion events and AgentRuntime updates use separate contracts."],
    ["06", "Autosave", "Accepted editor changes enter the serialized save queue."],
    ["07", "Reduce", "Committed suggestion events enter the inbox state machine."],
  ];
  const previewSteps = [
    ["01", "Request", "A text suggestion asks the workspace controller to preview."],
    ["02", "Place", "The controller inserts a custom preview after the last active accepted block."],
    ["03", "Own", "The inbox records the one active preview; the user can edit it freely."],
    ["04", "Resolve", "Accept replaces it with a paragraph; Cancel removes it."],
    ["05", "Reconcile", "The preview event bridge resolves the suggestion in the reducer."],
  ];
  const steps = kind === "preview" ? previewSteps : architectureSteps;
  const title = kind === "preview" ? "Editable preview lifecycle" : "Application bootstrap";
  const label = kind === "preview" ? "Interaction sequence" : "Runtime sequence";
  return `<figure class="diagram diagram--timeline" aria-labelledby="${kind}-timeline-title">
    <figcaption id="${kind}-timeline-title"><span class="diagram__eyebrow">${label}</span><strong>${title}</strong></figcaption>
    <ol class="timeline-steps">
      ${steps.map(([number, heading, detail]) => `<li><span class="timeline-number">${number}</span><div><strong>${heading}</strong><p>${detail}</p></div></li>`).join("")}
    </ol>
    <details class="diagram-source"><summary>View Mermaid source</summary><pre><code>${escapeHtml(source)}</code></pre></details>
  </figure>`;
}

function renderPinLifecycle(source) {
  return `<figure class="diagram diagram--states" aria-labelledby="pin-lifecycle-title">
    <figcaption id="pin-lifecycle-title"><span class="diagram__eyebrow">State model</span><strong>A suggestion moves between three explicit homes</strong></figcaption>
    <div class="state-flow">
      <div class="state-node"><small>Live</small><strong>Inbox</strong><span>Agent-owned stream</span></div>
      <div class="state-actions"><span>Pin →</span><span>← Unpin</span></div>
      <div class="state-node state-node--active"><small>Frozen</small><strong>Pins</strong><span>User-owned snapshot</span></div>
      <div class="state-actions"><span>Place →</span><span>← Return</span></div>
      <div class="state-node"><small>Desktop</small><strong>Workspace</strong><span>Positioned reference</span></div>
    </div>
    <p class="state-exit"><span aria-hidden="true">×</span> Inbox and Pins can exit through dismiss or an accepted preview; normal live items can also be retracted.</p>
    <details class="diagram-source"><summary>View Mermaid source</summary><pre><code>${escapeHtml(source)}</code></pre></details>
  </figure>`;
}

function renderDiagram(source) {
  if (source.includes('Main["Electron main process"]')) {
    return renderProcessMap(source);
  }
  if (source.includes("Shell[App composition root]")) {
    return renderArchitectureMap(source);
  }
  if (source.includes("participant Main as main.tsx")) {
    return renderTimeline(source, "bootstrap");
  }
  if (source.includes("participant User")) {
    return renderTimeline(source, "preview");
  }
  return renderPinLifecycle(source);
}

function rewriteHref(href) {
  if (/^(?:[a-z]+:|#|\/)/i.test(href)) {
    return href;
  }
  const [file, hash] = href.split("#", 2);
  let rewritten = file;
  if (file === "README.md") {
    rewritten = "index.html";
  } else if (file.endsWith(".md")) {
    rewritten = file.replace(/\.md$/, ".html");
  } else if (file.startsWith("../")) {
    rewritten = `../${file}`;
  }
  return hash === undefined ? rewritten : `${rewritten}#${hash}`;
}

function renderMarkdown(source) {
  const toc = [];
  const usedSlugs = new Map();
  const renderer = new Renderer();
  renderer.heading = (token) => {
      const base = slugify(token.text);
      const count = usedSlugs.get(base) ?? 0;
      usedSlugs.set(base, count + 1);
      const id = count ? `${base}-${count + 1}` : base;
      const text = stripMarkdown(token.text);
      if (token.depth === 2 || token.depth === 3) {
        toc.push({ depth: token.depth, id, text });
      }
      const inline = marked.parseInline(token.text);
      return `<h${token.depth} id="${id}">${inline}<a class="heading-anchor" href="#${id}" aria-label="Link to ${escapeHtml(text)}">#</a></h${token.depth}>`;
    };
  renderer.code = (token) => {
      const language = (token.lang || "").trim().split(/\s+/)[0];
      if (language === "mermaid") {
        return renderDiagram(token.text);
      }
      const languageLabel = language || "text";
      return `<div class="code-block" data-language="${escapeHtml(languageLabel)}"><div class="code-block__bar"><span>${escapeHtml(languageLabel)}</span><button type="button" class="copy-code" aria-label="Copy code">${icon("copy")}<span>Copy</span></button></div><pre><code class="language-${escapeHtml(languageLabel)}">${escapeHtml(token.text)}</code></pre></div>`;
    };

  const body = source.replace(/^# .+\r?\n+/, "");
  let html = marked.parse(body, { gfm: true, renderer });
  html = html.replace(/href="([^"]+)"/g, (_match, href) => `href="${escapeHtml(rewriteHref(href))}"`);
  return { html, toc };
}

function renderNavigation(currentPage) {
  return groups
    .map((group) => {
      const links = pages
        .filter((page) => page.category === group)
        .map((page) => {
          const active = page.output === currentPage.output;
          return `<a class="nav-link${active ? " is-active" : ""}" href="${page.output}"${active ? ' aria-current="page"' : ""}>
            <span class="nav-link__number">${page.number}</span>
            <span>${page.shortTitle}</span>
          </a>`;
        })
        .join("");
      return `<section class="nav-group"><h2>${group}</h2><nav aria-label="${group}">${links}</nav></section>`;
    })
    .join("");
}

function renderToc(toc) {
  return toc
    .map(
      (entry) =>
        `<a class="toc-link toc-link--${entry.depth}" href="#${entry.id}">${escapeHtml(entry.text)}</a>`,
    )
    .join("");
}

function renderPage(page, index, source, rendered) {
  const previous = pages[index - 1];
  const next = pages[index + 1];
  const wordCount = stripMarkdown(source).split(/\s+/).filter(Boolean).length;
  const readingTime = Math.max(1, Math.ceil(wordCount / 220));
  const sourceLink = `../${page.source}`;
  const navigation = renderNavigation(page);
  const toc = renderToc(rendered.toc);
  const pagination = `<nav class="page-pagination" aria-label="Documentation pages">
    ${previous ? `<a class="page-pagination__link page-pagination__link--previous" href="${previous.output}"><span>Previous</span><strong>← ${previous.shortTitle}</strong></a>` : '<span class="page-pagination__spacer"></span>'}
    ${next ? `<a class="page-pagination__link page-pagination__link--next" href="${next.output}"><span>Next</span><strong>${next.shortTitle} →</strong></a>` : '<span class="page-pagination__spacer"></span>'}
  </nav>`;

  return `<!doctype html>
<html lang="en" data-theme="light">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="${escapeHtml(page.description)}" />
    <meta name="theme-color" content="#f7f8fc" />
    <title>${escapeHtml(page.title)} · ScribeAI docs</title>
    <link rel="stylesheet" href="assets/styles.css" />
    <script>try{const t=localStorage.getItem("scribe-docs-theme");if(t){document.documentElement.dataset.theme=t}else if(matchMedia("(prefers-color-scheme: dark)").matches){document.documentElement.dataset.theme="dark"}}catch{}</script>
    <script src="assets/search-index.js" defer></script>
    <script src="assets/site.js" defer></script>
  </head>
  <body data-page="${page.output}">
    <a class="skip-link" href="#main-content">Skip to content</a>
    <div class="reading-progress" aria-hidden="true"><span></span></div>
    <div class="mobile-overlay" data-nav-close hidden></div>
    <aside class="site-sidebar" id="site-navigation" aria-label="Documentation navigation">
      <div class="sidebar-header">
        <a class="brand" href="index.html" aria-label="ScribeAI documentation home">
          <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
          <span><strong>ScribeAI</strong><small>Developer docs</small></span>
        </a>
        <button type="button" class="icon-button sidebar-close" data-nav-close aria-label="Close navigation">${icon("close")}</button>
      </div>
      <div class="sidebar-search">
        <button type="button" class="search-trigger" data-search-open aria-label="Search documentation">
          ${icon("search")}<span>Search docs</span><kbd>⌘ K</kbd>
        </button>
      </div>
      <div class="sidebar-scroll">${navigation}</div>
      <div class="sidebar-footer">
        <span class="status-dot" aria-hidden="true"></span>
        <span><strong>Current snapshot</strong><small>Client-only prototype</small></span>
      </div>
    </aside>

    <header class="mobile-header">
      <button type="button" class="icon-button" data-nav-open aria-controls="site-navigation" aria-expanded="false" aria-label="Open navigation">${icon("menu")}</button>
      <a class="mobile-brand" href="index.html"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span><strong>ScribeAI docs</strong></a>
      <button type="button" class="icon-button" data-theme-toggle aria-label="Switch color theme">${icon("sun", "theme-icon theme-icon--sun")}${icon("moon", "theme-icon theme-icon--moon")}</button>
    </header>

    <div class="search-dialog" data-search-dialog role="dialog" aria-modal="true" aria-labelledby="search-title" hidden>
      <div class="search-backdrop" data-search-close></div>
      <div class="search-panel">
        <div class="search-input-wrap">
          ${icon("search")}
          <label class="sr-only" id="search-title" for="site-search">Search documentation</label>
          <input id="site-search" type="search" placeholder="Search architecture, previews, testing…" autocomplete="off" data-search-input />
          <button type="button" class="search-close" data-search-close aria-label="Close search"><kbd>Esc</kbd></button>
        </div>
        <div class="search-results" data-search-results>
          <div class="search-empty"><span class="search-empty__mark">⌕</span><p>Search all documentation guides.</p><small>Try “preview”, “localStorage”, or “reducer”.</small></div>
        </div>
      </div>
    </div>

    <main class="site-main" id="main-content">
      <div class="desktop-toolbar">
        <nav class="breadcrumbs" aria-label="Breadcrumb"><a href="index.html">Developer docs</a><span>/</span><span>${escapeHtml(page.category)}</span></nav>
        <div class="toolbar-actions">
          <button type="button" class="toolbar-search" data-search-open>${icon("search")}<span>Search</span><kbd>⌘ K</kbd></button>
          <button type="button" class="icon-button" data-theme-toggle aria-label="Switch color theme">${icon("sun", "theme-icon theme-icon--sun")}${icon("moon", "theme-icon theme-icon--moon")}</button>
        </div>
      </div>

      <div class="page-shell">
        <div class="content-column">
          <header class="page-hero page-hero--${page.accent}">
            <div class="page-hero__meta"><span>Guide ${page.number}</span><span>${readingTime} min read</span></div>
            <h1>${escapeHtml(page.title)}</h1>
            <p>${escapeHtml(page.description)}</p>
            <div class="page-hero__footer">
              <span><i class="status-dot" aria-hidden="true"></i> Reflects the current codebase</span>
              <a href="${sourceLink}">View Markdown ${icon("external")}</a>
            </div>
            <div class="hero-orbit" aria-hidden="true"><i></i><i></i><i></i></div>
          </header>

          <article class="prose">${rendered.html}</article>
          ${pagination}
          <footer class="content-footer"><p>ScribeAI developer documentation</p><p>Generated from <a href="${sourceLink}">${page.source}</a>.</p></footer>
        </div>

        <aside class="page-toc" aria-label="On this page">
          <div class="page-toc__inner">
            <h2>On this page</h2>
            <nav>${toc}</nav>
            <a class="toc-source" href="${sourceLink}">${icon("external")} View source</a>
          </div>
        </aside>
      </div>
    </main>
    <noscript><div class="noscript">JavaScript is only used for search, navigation controls, and theme switching. All documentation content remains available.</div></noscript>
  </body>
</html>`;
}

function buildSearchIndex(sourceByPage) {
  return pages.flatMap((page) => {
    const source = sourceByPage.get(page.output);
    const lines = source.split(/\r?\n/);
    const entries = [
      {
        page: page.output,
        title: page.shortTitle,
        section: page.category,
        excerpt: page.description,
        content: stripMarkdown(source).slice(0, 1200),
      },
    ];

    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(/^(##|###)\s+(.+)$/);
      if (!match) continue;
      const heading = stripMarkdown(match[2]);
      const paragraph = [];
      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        if (/^#{1,3}\s+/.test(lines[cursor])) break;
        if (lines[cursor].trim() && !lines[cursor].startsWith("```") && !lines[cursor].startsWith("|")) {
          paragraph.push(lines[cursor].trim());
        }
        if (stripMarkdown(paragraph.join(" ")).length > 240) break;
      }
      entries.push({
        page: `${page.output}#${slugify(match[2])}`,
        title: heading,
        section: page.shortTitle,
        excerpt: stripMarkdown(paragraph.join(" ")).slice(0, 220),
        content: `${heading} ${stripMarkdown(paragraph.join(" "))}`,
      });
    }
    return entries;
  });
}

fs.rmSync(siteDirectory, { recursive: true, force: true });
fs.mkdirSync(path.join(siteDirectory, "assets"), { recursive: true });
fs.cpSync(staticAssetsDirectory, path.join(siteDirectory, "assets"), {
  recursive: true,
});

const sourceByPage = new Map();
for (const page of pages) {
  sourceByPage.set(
    page.output,
    fs.readFileSync(path.join(docsDirectory, page.source), "utf8"),
  );
}

for (const [index, page] of pages.entries()) {
  const source = sourceByPage.get(page.output);
  const rendered = renderMarkdown(source);
  fs.writeFileSync(
    path.join(siteDirectory, page.output),
    renderPage(page, index, source, rendered),
  );
}

const searchIndex = buildSearchIndex(sourceByPage);
fs.writeFileSync(
  path.join(siteDirectory, "assets/search-index.js"),
  `window.__SCRIBE_DOC_SEARCH__ = ${JSON.stringify(searchIndex)};\n`,
);

console.log(`Built ${pages.length} documentation pages and ${searchIndex.length} search entries.`);
