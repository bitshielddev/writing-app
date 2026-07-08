import { contextBridge, ipcRenderer } from "electron";
import { exposePreloadBridges } from "./preload-bridge.js";

exposePreloadBridges({
  contextBridge,
  ipcRenderer,
  testing: process.argv.includes("--scribe-e2e"),
});
