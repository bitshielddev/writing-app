import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, extname, join, parse } from "node:path";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";

import type { StoragePaths } from "./config.js";
import type { CopiedSource, WorkspaceFiles } from "../application/ports.js";

export class NodeWorkspaceFiles implements WorkspaceFiles {
  constructor(readonly paths: StoragePaths) {}

  /**
   * What: performs the ensure directories step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by repairDraft and createWorkspaceFiles when that path needs this behavior.
   */
  async ensureDirectories() {
    await mkdir(this.paths.sourcesDirectory, { recursive: true });
    await mkdir(this.paths.piDirectory, { recursive: true });
  }

  /**
   * What: performs the write draft step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports, performDocumentSave, fixture and operations when that path needs this behavior.
   */
  async writeDraft(markdown: string) {
    const temporary = join(this.paths.workspaceRoot, `.draft-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, markdown, "utf8");
      await rename(temporary, this.paths.draftPath);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  /**
   * What: performs the repair draft step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports, repairWorkspace, performDocumentSave and fixture when that path needs this behavior.
   */
  async repairDraft(markdown: string) {
    await this.ensureDirectories();
    let current: string | undefined;
    try {
      current = await readFile(this.paths.draftPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const repaired = current !== markdown;
    if (repaired) await this.writeDraft(markdown);
    return { repaired };
  }

  /**
   * What: performs the copy source step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports, importSource, fixture and createWorkspaceFiles when that path needs this behavior.
   */
  async copySource(sourcePath: string): Promise<CopiedSource> {
    const bytes = await readFile(sourcePath);
    validateMarkdownSource(sourcePath, bytes);
    await mkdir(this.paths.sourcesDirectory, { recursive: true });
    const original = basename(sourcePath);
    const parsed = parse(original);
    for (let index = 1; ; index += 1) {
      const filename = index === 1 ? original : `${parsed.name} (${index})${parsed.ext}`;
      const destination = join(this.paths.sourcesDirectory, filename);
      try {
        await copyFile(sourcePath, destination, constants.COPYFILE_EXCL);
        return { filename, destination, bytes: bytes.byteLength };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
  }

  /**
   * What: performs the remove source step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports, importSource, fixture and createWorkspaceFiles when that path needs this behavior.
   */
  async removeSource(path: string) {
    await rm(path, { force: true });
  }

  /**
   * What: performs the remove workspace step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports, deleteProject and deleteDocument when that path needs this behavior.
   */
  async removeWorkspace() {
    await rm(this.paths.workspaceRoot, { recursive: true, force: true });
  }
}

/**
 * What: validates markdown source before callers depend on it.
 *
 * Why: storage workflows need durable, transactional behavior behind the application contract.
 * Called when: used by copySource when that path needs this behavior.
 */
export function validateMarkdownSource(path: string, bytes: Uint8Array) {
  const extension = extname(path).toLocaleLowerCase();
  if (extension !== ".md" && extension !== ".markdown") {
    throw new Error("Only .md and .markdown source files are supported");
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Markdown source must contain valid UTF-8");
  }
}
