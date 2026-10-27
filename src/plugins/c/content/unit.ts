import { basename, extname } from "path";

const ARTIFACT_EXTS = [".a", ".so", ".dylib", ".lib", ".dll"];

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
  get isMain(): boolean { return this.name === "main.c"; }
  get isArtifact(): boolean { return ARTIFACT_EXTS.includes(this.ext); }
}
