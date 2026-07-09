import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { RuntimeRequired } from "./RuntimeRequired";
import { getDesktopBridge } from "../platform/electron/desktopClient";
import { markPerformance, PERFORMANCE_MARKS } from "../platform/performance/marks";
import "../index.css";

markPerformance(PERFORMANCE_MARKS.bootstrap);

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

let rootView;
try {
  const desktop = getDesktopBridge();
  rootView = <App desktop={desktop} />;
} catch (error) {
  rootView = (
    <RuntimeRequired
      message={error instanceof Error ? error.message : String(error)}
    />
  );
}

createRoot(rootElement).render(
  <StrictMode>
    {rootView}
  </StrictMode>,
);
