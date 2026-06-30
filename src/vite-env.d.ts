/// <reference types="vite/client" />

import type { DesktopBridge } from "./shared/desktop";

declare global {
  interface Window {
    scribe?: DesktopBridge;
  }
}

export {};
