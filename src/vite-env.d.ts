/// <reference types="vite/client" />

import type { DesktopBridge } from "./shared/desktop";

declare global {
  interface Window {
    scribe?: DesktopBridge;
    scribeTest?: {
      readiness(): Promise<{ ready: boolean; health: import("./shared/desktop").ProcessHealthSnapshot; userDataPath: string }>;
      terminateStorage(): Promise<{ accepted: boolean }>;
      terminateAgent(): Promise<{ accepted: boolean }>;
    };
    scribeFlush?: () => void | Promise<void>;
  }
}

export {};
