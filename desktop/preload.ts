import { contextBridge, ipcRenderer } from "electron";
import { exposePreloadBridges } from "./preload-bridge.js";

exposePreloadBridges({
  contextBridge,
  ipcRenderer,
  development: process.argv.includes("--scribe-development"),
});
