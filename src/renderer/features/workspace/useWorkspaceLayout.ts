import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

export const MIN_NAVIGATION_WIDTH = 220;
export const MIN_CONTEXT_WIDTH = 280;

const MAX_NAVIGATION_WIDTH = 380;
const MAX_CONTEXT_WIDTH = 720;
const MIN_EDITOR_WIDTH = 520;
const NAVIGATION_WIDTH_KEY = "scribe-navigation-column-width";
const CONTEXT_WIDTH_KEY = "scribe-context-column-width";
const DESKTOP_QUERY = "(min-width: 1280px)";

function readSavedWidth(key: string, min: number, max: number) {
  try {
    const width = Number(window.localStorage.getItem(key));
    return Number.isFinite(width) && width >= min && width <= max
      ? width
      : null;
  } catch {
    return null;
  }
}

function saveWidth(key: string, width: number | null) {
  try {
    if (width === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, String(width));
    }
  } catch {
    // Resizing still works when storage is unavailable.
  }
}

export function useWorkspaceLayout() {
  const workspaceRef = useRef<HTMLElement>(null);
  const navigationColumnRef = useRef<HTMLDivElement>(null);
  const contextColumnRef = useRef<HTMLDivElement>(null);
  const navigationRegionRef = useRef<HTMLElement>(null);
  const contextRegionRef = useRef<HTMLElement>(null);
  const [desktop, setDesktop] = useState(() =>
    window.matchMedia(DESKTOP_QUERY).matches,
  );
  const [navigationDrawerOpen, setNavigationDrawerOpen] = useState(false);
  const [contextDrawerOpen, setContextDrawerOpen] = useState(false);
  const [navigationPanelOpen, setNavigationPanelOpen] = useState(true);
  const [contextPanelOpen, setContextPanelOpen] = useState(true);
  const [navigationColumnWidth, setNavigationColumnWidth] = useState<
    number | null
  >(() =>
    readSavedWidth(
      NAVIGATION_WIDTH_KEY,
      MIN_NAVIGATION_WIDTH,
      MAX_NAVIGATION_WIDTH,
    ),
  );
  const [contextColumnWidth, setContextColumnWidth] = useState<number | null>(
    () =>
      readSavedWidth(
        CONTEXT_WIDTH_KEY,
        MIN_CONTEXT_WIDTH,
        MAX_CONTEXT_WIDTH,
      ),
  );

  const isDesktop = useCallback(() => desktop, [desktop]);

  const getMaximumNavigationWidth = useCallback(() => {
    const workspaceWidth =
      workspaceRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const contextWidth = contextPanelOpen
      ? (contextColumnRef.current?.getBoundingClientRect().width ??
        MIN_CONTEXT_WIDTH)
      : 0;
    return Math.max(
      MIN_NAVIGATION_WIDTH,
      Math.min(
        MAX_NAVIGATION_WIDTH,
        workspaceWidth - contextWidth - MIN_EDITOR_WIDTH,
      ),
    );
  }, [contextPanelOpen]);

  const getMaximumContextWidth = useCallback(() => {
    const workspaceWidth =
      workspaceRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const navigationWidth = navigationPanelOpen
      ? (navigationColumnRef.current?.getBoundingClientRect().width ??
        MIN_NAVIGATION_WIDTH)
      : 0;
    return Math.max(
      MIN_CONTEXT_WIDTH,
      Math.min(
        MAX_CONTEXT_WIDTH,
        workspaceWidth - navigationWidth - MIN_EDITOR_WIDTH,
      ),
    );
  }, [navigationPanelOpen]);

  const resizeNavigationColumn = useCallback((width: number) => {
    setNavigationColumnWidth(width);
    saveWidth(NAVIGATION_WIDTH_KEY, width);
  }, []);
  const resizeContextColumn = useCallback((width: number) => {
    setContextColumnWidth(width);
    saveWidth(CONTEXT_WIDTH_KEY, width);
  }, []);
  const resetNavigationColumn = useCallback(() => {
    setNavigationColumnWidth(null);
    saveWidth(NAVIGATION_WIDTH_KEY, null);
  }, []);
  const resetContextColumn = useCallback(() => {
    setContextColumnWidth(null);
    saveWidth(CONTEXT_WIDTH_KEY, null);
  }, []);

  const openNavigation = useCallback(() => {
    if (isDesktop()) {
      setNavigationPanelOpen(true);
    } else {
      setNavigationDrawerOpen(true);
      setContextDrawerOpen(false);
    }
  }, [isDesktop]);
  const openContext = useCallback(() => {
    if (isDesktop()) {
      setContextPanelOpen(true);
    } else {
      setContextDrawerOpen(true);
      setNavigationDrawerOpen(false);
    }
  }, [isDesktop]);
  const toggleNavigation = useCallback(() => {
    if (isDesktop()) {
      setNavigationPanelOpen((open) => !open);
    } else {
      setNavigationDrawerOpen((open) => !open);
      setContextDrawerOpen(false);
    }
  }, [isDesktop]);
  const toggleContext = useCallback(() => {
    if (isDesktop()) {
      setContextPanelOpen((open) => !open);
    } else {
      setContextDrawerOpen((open) => !open);
      setNavigationDrawerOpen(false);
    }
  }, [isDesktop]);
  const closeDrawers = useCallback(() => {
    setNavigationDrawerOpen(false);
    setContextDrawerOpen(false);
  }, []);
  const closeNavigationDrawer = useCallback(
    () => setNavigationDrawerOpen(false),
    [],
  );
  const closeContextDrawer = useCallback(() => setContextDrawerOpen(false), []);

  useEffect(() => {
    const constrainSavedWidths = () => {
      if (!isDesktop()) return;

      setNavigationColumnWidth((width) => {
        if (width === null) return null;
        const constrained = Math.min(width, getMaximumNavigationWidth());
        saveWidth(NAVIGATION_WIDTH_KEY, constrained);
        return constrained;
      });
      setContextColumnWidth((width) => {
        if (width === null) return null;
        const constrained = Math.min(width, getMaximumContextWidth());
        saveWidth(CONTEXT_WIDTH_KEY, constrained);
        return constrained;
      });
    };

    constrainSavedWidths();
    window.addEventListener("resize", constrainSavedWidths);
    return () => window.removeEventListener("resize", constrainSavedWidths);
  }, [getMaximumContextWidth, getMaximumNavigationWidth, isDesktop]);

  useEffect(() => {
    const desktopQuery = window.matchMedia(DESKTOP_QUERY);
    const closeDrawersAtDesktop = (event: MediaQueryListEvent) => {
      setDesktop(event.matches);
      if (event.matches) closeDrawers();
    };
    desktopQuery.addEventListener("change", closeDrawersAtDesktop);
    return () =>
      desktopQuery.removeEventListener("change", closeDrawersAtDesktop);
  }, [closeDrawers]);

  const columnStyles = {
    ...(navigationColumnWidth === null
      ? {}
      : { "--navigation-column-width": `${navigationColumnWidth}px` }),
    ...(contextColumnWidth === null
      ? {}
      : { "--context-column-width": `${contextColumnWidth}px` }),
  } as CSSProperties;

  return {
    workspaceRef,
    navigationColumnRef,
    contextColumnRef,
    navigationRegionRef,
    contextRegionRef,
    desktop,
    navigationDrawerOpen,
    contextDrawerOpen,
    navigationPanelOpen,
    contextPanelOpen,
    columnStyles,
    isDesktop,
    openNavigation,
    openContext,
    toggleNavigation,
    toggleContext,
    closeNavigationDrawer,
    closeContextDrawer,
    closeDrawers,
    getMaximumNavigationWidth,
    getMaximumContextWidth,
    resizeNavigationColumn,
    resizeContextColumn,
    resetNavigationColumn,
    resetContextColumn,
  };
}

export type WorkspaceLayoutController = ReturnType<typeof useWorkspaceLayout>;
