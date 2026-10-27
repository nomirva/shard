import { relative } from "path";

export interface Layout {
  readonly id: string;
  readonly moduleDir: string;
  readonly outDir: string;
  readonly objectDir: string;
  readonly includeDir: string;
}

export function moduleId(rootPath: string, modulePath: string): string {
  if (modulePath === rootPath) return "_";
  return relative(rootPath, modulePath).replace(/[/\\]+/g, "__");
}
