import { contextBridge, ipcRenderer } from "electron";
import { exposePreloadBridges } from "./bridge.js";

exposePreloadBridges({
  contextBridge,
  ipcRenderer,
  testing: process.argv.includes("--scribe-e2e"),
});
