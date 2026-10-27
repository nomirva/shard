import { createHash, type Hash } from "crypto";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import type { Task } from "./task";

/**
 * Hash of everything a task's result depends on: its type, every declared
 * input value, the contents of input files (directories walked in sorted
 * order) and of files the previous run discovered.
 */
export function fingerprintTask(task: Task, discovered: readonly string[]): string {
  const hash = createHash("sha256");
  hash.update(`${task.constructor.name}\0${task.path}\0`);
  for (const input of task.declaredInputs()) {
    hash.update(`${input.name}\0`);
    const value = input.value.isPresent() ? input.value.get() : undefined;
    if (input.kind === "files") for (const file of value as string[]) hashPath(hash, file);
    else hash.update(JSON.stringify(value) ?? "undefined");
  }
  hash.update("\0discovered\0");
  for (const file of discovered) hashPath(hash, file);
  return hash.digest("hex");
}

/** Output files and directories of a task, flattened. */
export function outputPaths(task: Task): string[] {
  return task.declaredOutputs().flatMap(output => {
    if (!output.files.isPresent()) return [];
    const value = output.files.get();
    return Array.isArray(value) ? value : [value];
  });
}

function hashPath(hash: Hash, path: string): void {
  hash.update(`${path}\0`);
  let stat;
  try {
    stat = statSync(path);
  } catch {
    hash.update("missing\0");
    return;
  }
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path).sort()) hashPath(hash, join(path, entry));
    return;
  }
  hash.update(readFileSync(path));
  hash.update("\0");
}
