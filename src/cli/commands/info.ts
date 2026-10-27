import { describeDependency, parseDependencies } from "../../dependency/parse";
import { privateIncludes, scanContent } from "../../target/content";
import { deriveShape } from "../../target/shape";
import { DIRS } from "../../workspace/layout";
import { openWorkspace } from "./workspace";

export function infoCommand(path: string): void {
  const ws = openWorkspace(path, false);
  const target = ws.declareRoot();
  const content = scanContent(target.path, target.manifest, DIRS.TARGET);
  const deps = parseDependencies(target.manifest.depend);

  console.log(`\n  Name: ${target.manifest.name ?? target.name}`);
  console.log(`  Type: ${deriveShape(content, target.name)}`);
  console.log(`  Include: ${privateIncludes(target.path, target.manifest, content)[0] ?? "(none)"}`);
  if (deps.length) {
    console.log(`  Dependencies (${deps.length}):`);
    for (const dep of deps) console.log(`    - ${describeDependency(dep)}`);
  } else {
    console.log(`  Dependencies: none`);
  }
}
