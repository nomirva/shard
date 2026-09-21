import type { Module } from "./module";
import type { LinkType } from "./types";
import { ShardError } from "../utils/errors";

export class ModuleGraph {
  private readonly nodes = new Map<string, Module>();
  private readonly childMap = new Map<Module, Module[]>();
  private readonly linkMap = new Map<Module, LinkType | null>();
  private readonly flagMap = new Map<Module, string[]>();
  private rootModule: Module | null = null;

  addNode(module: Module): Module {
    const existing = this.nodes.get(module.path);
    if (existing) return existing;
    this.nodes.set(module.path, module);
    this.childMap.set(module, []);
    return module;
  }

  node(path: string): Module | undefined {
    return this.nodes.get(path);
  }

  setRoot(module: Module): void {
    this.addNode(module);
    this.rootModule = module;
  }

  get root(): Module {
    if (!this.rootModule) throw new ShardError("build", "Module graph has no root");
    return this.rootModule;
  }

  connect(parent: Module, child: Module, link: LinkType | null): void {
    this.addNode(parent);
    this.addNode(child);

    const children = this.childMap.get(parent)!;
    if (!children.includes(child)) children.push(child);

    if (!this.linkMap.has(child)) this.linkMap.set(child, link);
  }

  addFlags(module: Module, flags: string[]): void {
    this.flagMap.set(module, [...(this.flagMap.get(module) ?? []), ...flags]);
  }

  children(module: Module): Module[] {
    return this.childMap.get(module) ?? [];
  }

  linkOf(module: Module): LinkType | null {
    return this.linkMap.get(module) ?? null;
  }

  flagsOf(module: Module): string[] {
    return this.flagMap.get(module) ?? [];
  }

  topoOrder(): Module[] {
    const out: Module[] = [];
    const seen = new Set<Module>();
    const walk = (m: Module): void => {
      if (seen.has(m)) return;
      seen.add(m);
      for (const child of this.children(m)) walk(child);
      out.push(m);
    };
    walk(this.root);
    return out;
  }
}
