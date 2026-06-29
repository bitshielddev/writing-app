import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { MockSuggestionController } from "./dev/mockSuggestions/MockSuggestionController";
import { MOCK_SUGGESTION_PATH } from "./dev/mockSuggestions/mockSuggestionChannel";
import "./index.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

const normalizedPath = window.location.pathname.replace(/\/+$/, "") || "/";
const rootView =
  normalizedPath === MOCK_SUGGESTION_PATH ? (
    <MockSuggestionController />
  ) : (
    <App />
  );

createRoot(rootElement).render(
  <StrictMode>
    {rootView}
  </StrictMode>,
);
