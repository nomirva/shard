import { basename, extname } from "path";

export class Unit {
  readonly path: string;
  readonly ext: string;
  readonly name: string;

  constructor(path: string) {
    this.path = path;
    this.ext = extname(path);
    this.name = basename(path);
  }

  get isC(): boolean { return this.ext === ".c"; }
  get isHeader(): boolean { return this.ext === ".h"; }
  get isMain(): boolean { return this.name === "main.c"; }
  get isArtifact(): boolean {
    return [".a", ".so", ".dylib", ".lib", ".dll"].includes(this.ext);
  }
}
