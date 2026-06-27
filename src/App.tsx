import { useEffect, useState } from "react";

import { ContextGutter } from "./components/ContextGutter";
import { EditorWorkspace } from "./components/EditorWorkspace";
import { ResponsiveDrawer } from "./components/ResponsiveDrawer";
import { Sidebar } from "./components/Sidebar";

export default function App() {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);

  useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 1280px)");
    const closeDrawersAtDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) {
        setNavigationOpen(false);
        setContextOpen(false);
      }
    };

    desktopQuery.addEventListener("change", closeDrawersAtDesktop);
    return () => desktopQuery.removeEventListener("change", closeDrawersAtDesktop);
  }, []);

  return (
    <div className="app-background min-h-dvh p-0 xl:p-2 2xl:p-[18px]">
      <main
        aria-label="ScribeAI writing workspace"
        className="grid h-dvh min-h-0 overflow-hidden bg-white xl:h-[calc(100dvh-1rem)] xl:grid-cols-[248px_minmax(0,1fr)_320px] xl:rounded-3xl xl:border xl:border-[#bec0cb] xl:shadow-[0_22px_70px_rgb(0_0_0/28%)] 2xl:h-[calc(100dvh-36px)] 2xl:grid-cols-[280px_minmax(0,1fr)_360px] 2xl:rounded-[2rem]"
      >
        <div className="hidden min-h-0 xl:block">
          <Sidebar />
        </div>

        <EditorWorkspace
          onOpenNavigation={() => setNavigationOpen(true)}
          onOpenContext={() => setContextOpen(true)}
        />

        <div className="hidden min-h-0 xl:block">
          <ContextGutter />
        </div>
      </main>

      <ResponsiveDrawer
        id="navigation-drawer"
        title="Project navigation"
        side="left"
        open={navigationOpen}
        onClose={() => setNavigationOpen(false)}
      >
        <Sidebar />
      </ResponsiveDrawer>

      <ResponsiveDrawer
        id="context-drawer"
        title="AI context"
        side="right"
        open={contextOpen}
        onClose={() => setContextOpen(false)}
      >
        <ContextGutter />
      </ResponsiveDrawer>
    </div>
  );
}
