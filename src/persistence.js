import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { badRequest } from "./errors.js";

export class JsonStateStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async load() {
    try {
      const contents = await readFile(this.filePath, "utf8");
      const state = JSON.parse(contents);
      if (!state || typeof state !== "object" || Array.isArray(state) || (state.version !== 1 && state.version !== 2)) {
        throw badRequest("INVALID_PERSISTED_STATE");
      }
      return state;
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      if (error instanceof SyntaxError) throw badRequest("INVALID_PERSISTED_STATE");
      throw error;
    }
  }

  async save(state) {
    const targetDirectory = dirname(this.filePath);
    const temporaryPath = `${this.filePath}.tmp`;
    await mkdir(targetDirectory, { recursive: true, mode: 0o700 });
    await writeFile(temporaryPath, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }
}
