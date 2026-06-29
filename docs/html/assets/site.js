(() => {
  "use strict";

  const root = document.documentElement;
  const body = document.body;
  const searchDialog = document.querySelector("[data-search-dialog]");
  const searchInput = document.querySelector("[data-search-input]");
  const searchResults = document.querySelector("[data-search-results]");
  const navigation = document.getElementById("site-navigation");
  const mobileOverlay = document.querySelector(".mobile-overlay");
  const navTrigger = document.querySelector("[data-nav-open]");
  let searchReturnFocus = null;
  let navReturnFocus = null;
  let selectedSearchIndex = -1;

  const escapeHtml = (value) =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const updateThemeControls = () => {
    const dark = root.dataset.theme === "dark";
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
      button.setAttribute("title", dark ? "Switch to light theme" : "Switch to dark theme");
    });
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      "content",
      dark ? "#111119" : "#f6f7fb",
    );
  };

  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = root.dataset.theme === "dark" ? "light" : "dark";
      root.dataset.theme = next;
      try {
        localStorage.setItem("scribe-docs-theme", next);
      } catch {
        // Theme still applies for the current page if storage is unavailable.
      }
      updateThemeControls();
    });
  });
  updateThemeControls();

  const openNavigation = () => {
    navReturnFocus = document.activeElement;
    body.classList.add("nav-open");
    mobileOverlay.hidden = false;
    navTrigger?.setAttribute("aria-expanded", "true");
    navigation?.querySelector(".sidebar-close")?.focus();
  };

  const closeNavigation = ({ restoreFocus = true } = {}) => {
    body.classList.remove("nav-open");
    mobileOverlay.hidden = true;
    navTrigger?.setAttribute("aria-expanded", "false");
    if (restoreFocus && navReturnFocus instanceof HTMLElement) {
      navReturnFocus.focus();
    }
  };

  navTrigger?.addEventListener("click", openNavigation);
  document.querySelectorAll("[data-nav-close]").forEach((button) => {
    button.addEventListener("click", () => closeNavigation());
  });
  navigation?.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => closeNavigation({ restoreFocus: false }));
  });
  window.matchMedia("(min-width: 60.001rem)").addEventListener("change", (event) => {
    if (event.matches && body.classList.contains("nav-open")) {
      closeNavigation({ restoreFocus: false });
    }
  });

  const emptySearch = () => {
    searchResults.innerHTML = `
      <div class="search-empty">
        <span class="search-empty__mark">⌕</span>
        <p>Search across all seven guides.</p>
        <small>Try “preview”, “localStorage”, or “reducer”.</small>
      </div>`;
    selectedSearchIndex = -1;
  };

  const scoreEntry = (entry, terms) => {
    const title = entry.title.toLowerCase();
    const section = entry.section.toLowerCase();
    const content = `${entry.excerpt} ${entry.content}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (!title.includes(term) && !section.includes(term) && !content.includes(term)) {
        return 0;
      }
      if (title === term) score += 80;
      else if (title.startsWith(term)) score += 40;
      else if (title.includes(term)) score += 24;
      if (section.includes(term)) score += 10;
      if (content.includes(term)) score += 4;
    }
    return score;
  };

  const runSearch = () => {
    const query = searchInput.value.trim().toLowerCase();
    if (!query) {
      emptySearch();
      return;
    }
    const terms = query.split(/\s+/).filter(Boolean);
    const matches = (window.__SCRIBE_DOC_SEARCH__ || [])
      .map((entry) => ({ entry, score: scoreEntry(entry, terms) }))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title))
      .slice(0, 12);

    selectedSearchIndex = matches.length ? 0 : -1;
    if (!matches.length) {
      searchResults.innerHTML = `
        <div class="search-empty">
          <span class="search-empty__mark">∅</span>
          <p>No matches for “${escapeHtml(query)}”</p>
          <small>Try a shorter or more general term.</small>
        </div>`;
      return;
    }

    searchResults.innerHTML = `
      <div class="search-count">${matches.length} result${matches.length === 1 ? "" : "s"}</div>
      ${matches
        .map(
          ({ entry }, index) => `
            <a class="search-result${index === 0 ? " is-selected" : ""}" href="${escapeHtml(entry.page)}" data-search-result>
              <span class="search-result__meta">${escapeHtml(entry.section)}</span>
              <strong>${escapeHtml(entry.title)}</strong>
              <p>${escapeHtml(entry.excerpt || "Open this section in the documentation.")}</p>
            </a>`,
        )
        .join("")}`;
  };

  const updateSelectedResult = (nextIndex) => {
    const results = [...searchResults.querySelectorAll("[data-search-result]")];
    if (!results.length) return;
    selectedSearchIndex = Math.max(0, Math.min(nextIndex, results.length - 1));
    results.forEach((result, index) => {
      result.classList.toggle("is-selected", index === selectedSearchIndex);
    });
    results[selectedSearchIndex].scrollIntoView({ block: "nearest" });
  };

  const openSearch = (trigger = document.activeElement) => {
    if (!searchDialog.hidden) return;
    searchReturnFocus = trigger;
    searchDialog.hidden = false;
    body.style.overflow = "hidden";
    searchInput.value = "";
    emptySearch();
    requestAnimationFrame(() => searchInput.focus());
  };

  const closeSearch = ({ restoreFocus = true } = {}) => {
    if (searchDialog.hidden) return;
    searchDialog.hidden = true;
    body.style.overflow = "";
    if (restoreFocus && searchReturnFocus instanceof HTMLElement) {
      searchReturnFocus.focus();
    }
  };

  document.querySelectorAll("[data-search-open]").forEach((button) => {
    button.addEventListener("click", () => openSearch(button));
  });
  document.querySelectorAll("[data-search-close]").forEach((button) => {
    button.addEventListener("click", () => closeSearch());
  });
  searchInput?.addEventListener("input", runSearch);
  searchInput?.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      updateSelectedResult(selectedSearchIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      updateSelectedResult(selectedSearchIndex - 1);
    } else if (event.key === "Enter") {
      const results = [...searchResults.querySelectorAll("[data-search-result]")];
      if (selectedSearchIndex >= 0 && results[selectedSearchIndex]) {
        event.preventDefault();
        results[selectedSearchIndex].click();
      }
    }
  });

  document.addEventListener("keydown", (event) => {
    const searchShortcut =
      (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) ||
      (event.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName));
    if (searchShortcut) {
      event.preventDefault();
      openSearch();
      return;
    }

    if (event.key === "Escape") {
      if (!searchDialog.hidden) closeSearch();
      else if (body.classList.contains("nav-open")) closeNavigation();
      return;
    }

    if (event.key === "Tab" && !searchDialog.hidden) {
      const focusable = [...searchDialog.querySelectorAll('input, button, a[href], [tabindex]:not([tabindex="-1"])')]
        .filter((element) => !element.hasAttribute("disabled"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  document.querySelectorAll(".copy-code").forEach((button) => {
    button.addEventListener("click", async () => {
      const code = button.closest(".code-block")?.querySelector("code")?.textContent || "";
      const label = button.querySelector("span");
      try {
        await navigator.clipboard.writeText(code);
      } catch {
        const textArea = document.createElement("textarea");
        textArea.value = code;
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.append(textArea);
        textArea.select();
        document.execCommand("copy");
        textArea.remove();
      }
      label.textContent = "Copied";
      button.setAttribute("aria-label", "Code copied");
      window.setTimeout(() => {
        label.textContent = "Copy";
        button.setAttribute("aria-label", "Copy code");
      }, 1400);
    });
  });

  const updateReadingProgress = () => {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const progress = scrollable > 0 ? Math.min(100, (window.scrollY / scrollable) * 100) : 0;
    root.style.setProperty("--reading-progress", `${progress}%`);
  };
  updateReadingProgress();
  window.addEventListener("scroll", updateReadingProgress, { passive: true });
  window.addEventListener("resize", updateReadingProgress);

  const headings = [...document.querySelectorAll(".prose h2[id], .prose h3[id]")];
  const tocLinks = [...document.querySelectorAll(".toc-link")];
  if ("IntersectionObserver" in window && headings.length) {
    const visible = new Map();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) visible.set(entry.target.id, entry.boundingClientRect.top);
          else visible.delete(entry.target.id);
        });
        const active = [...visible.entries()].sort((a, b) => a[1] - b[1])[0]?.[0];
        if (!active) return;
        tocLinks.forEach((link) => {
          link.classList.toggle("is-active", link.getAttribute("href") === `#${active}`);
        });
      },
      { rootMargin: "-10% 0px -72% 0px", threshold: [0, 1] },
    );
    headings.forEach((heading) => observer.observe(heading));
  }
})();
