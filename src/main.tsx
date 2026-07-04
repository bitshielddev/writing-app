import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { RuntimeRequired } from "./components/RuntimeRequired";
import { getDesktopBridge } from "./desktop/desktopClient";
import { markPerformance, PERFORMANCE_MARKS } from "./performance/marks";
import "./index.css";

markPerformance(PERFORMANCE_MARKS.bootstrap);

const MOCK_SUGGESTION_PATH = "/mock-suggestions";
const MockSuggestionController = import.meta.env.DEV
  ? lazy(() =>
      import("./dev/mockSuggestions/MockSuggestionController").then(
        (module) => ({ default: module.MockSuggestionController }),
      ),
    )
  : null;

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

const normalizedPath = window.location.pathname.replace(/\/+$/, "") || "/";

let rootView;
try {
  const desktop = getDesktopBridge();
  if (normalizedPath === MOCK_SUGGESTION_PATH) {
    const development = window.scribeDevelopment;
    rootView =
      MockSuggestionController && development ? (
        <Suspense fallback={null}>
          <MockSuggestionController
            createSuggestion={development.createSuggestion}
          />
        </Suspense>
      ) : (
        <RuntimeRequired message="The mock suggestion controller is only available from the Electron development menu." />
      );
  } else {
    rootView = <App desktop={desktop} />;
  }
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
