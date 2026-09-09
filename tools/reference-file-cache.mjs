import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export function fileReferenceStorage(directory) {
  const path = (key) => {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid cache key");
    return join(directory, `${key}.json`);
  };
  return {
    get: async (key) => JSON.parse(await readFile(path(key), "utf8")),
    set: async (key, value) => {
      await mkdir(directory, { recursive: true });
      const target = path(key);
      const temporary = `${target}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(value), "utf8");
      await rename(temporary, target);
    }
  };
}
