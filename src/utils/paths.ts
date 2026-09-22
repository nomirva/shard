import { isAbsolute, relative } from "path";

export function relativeTo(fromDir: string, file: string): string {
  const rel = relative(fromDir, file);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path "${file}" is outside "${fromDir}"`);
  }
  return rel.replace(/\\/g, "/");
}

export function moduleId(rootPath: string, modulePath: string): string {
  if (modulePath === rootPath) return "_";
  return relative(rootPath, modulePath).replace(/[/\\]+/g, "__");
}
