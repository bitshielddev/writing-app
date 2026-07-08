/// <reference types="vite/client" />

import type { DesktopBridge } from "./contracts/desktop-bridge";

declare global {
  interface Window {
    scribe?: DesktopBridge;
    scribeTest?: {
      readiness(): Promise<{ ready: boolean; health: import("./contracts/desktop-bridge").ProcessHealthSnapshot; userDataPath: string }>;
      terminateStorage(): Promise<{ accepted: boolean }>;
      terminateAgent(): Promise<{ accepted: boolean }>;
    };
    scribeFlush?: () => void | Promise<void>;
  }
}

export {};
