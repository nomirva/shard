import { relative } from "path";

/** Where one module's objects, outputs and public headers live. */
export interface Layout {
  readonly id: string;
  readonly moduleDir: string;
  readonly outDir: string;
  readonly objectDir: string;
  readonly includeDir: string;
}

/** "_" for the root, otherwise the path from the root with separators as "__" ("..__lib"). */
export function moduleId(rootPath: string, modulePath: string): string {
  if (modulePath === rootPath) return "_";
  return relative(rootPath, modulePath).replace(/[/\\]+/g, "__");
}
