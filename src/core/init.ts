import { existsSync, realpathSync } from "fs";
import { basename, join } from "path";
import { ShardError } from "../utils/errors";
import { attribute, AttributeContainer } from "./attributes";
import type { Build } from "./build";
import type { Dependency, OutgoingVariant } from "./configurations";
import { moduleDependency } from "./configurations";
import type { Module, Plugin } from "./module";

export interface DependencyNotation {
  readonly source: string;
  readonly attributes?: Readonly<Record<string, string>>;
  readonly [field: string]: unknown;
}

export interface ResolutionNote {
  readonly action: string;
  readonly previous?: string;
  readonly flags?: readonly string[];
  readonly warnings?: readonly string[];
}

export type NotationTarget =
  | { readonly kind: "module"; readonly dir: string; readonly name?: string; readonly note?: ResolutionNote }
  | { readonly kind: "variants"; readonly name: string; readonly variants: readonly OutgoingVariant[]; readonly note?: ResolutionNote }
  | { readonly kind: "missing" };

export interface NotationInfo {
  readonly name: string;
  readonly source: string;
  readonly spec: string;
  readonly link: string | null;
}

export interface ResolveOptions {
  readonly requestedBy: readonly string[];
  readonly dryRun: boolean;
  readonly onProgress: (percent: number) => void;
}

export interface NotationHandler {
  readonly source: string;
  helper(...args: never[]): DependencyNotation;
  describe(notation: DependencyNotation): NotationInfo;
  resolve(notation: DependencyNotation, from: Module, options: ResolveOptions): NotationTarget | Promise<NotationTarget>;
}

export interface DeclaredEdge {
  readonly id: number;
  readonly parentId: number | null;
  readonly notation: DependencyNotation;
  readonly info: NotationInfo;
}

export interface ResolvedEdge {
  readonly target: NotationTarget;
  readonly dir?: string;
  readonly duplicate: boolean;
  readonly duration: number;
}

export interface InitListener {
  declared?(module: Module, edges: readonly DeclaredEdge[]): void;
  start?(edge: DeclaredEdge): void;
  progress?(edge: DeclaredEdge, percent: number): void;
  done?(edge: DeclaredEdge, result: ResolvedEdge): void;
  failed?(edge: DeclaredEdge, error: unknown): void;
  loaded?(module: Module, via: DeclaredEdge | null): void;
}

export interface ModuleConfig {
  readonly plugins?: readonly string[];
  readonly dependencies?: readonly DependencyNotation[] | Readonly<Record<string, readonly DependencyNotation[]>>;
  readonly [block: string]: unknown;
}

export interface ConfigContext {
  readonly platform: string;
  readonly arch: string;
  readonly defines: readonly string[];
  defined(name: string): boolean;
  define(name: string): string | undefined;
  readonly [helper: string]: unknown;
}

export interface ConfigReader {
  readonly file: string;
  read(dir: string, ctx: ConfigContext): Promise<ModuleConfig | null>;
}

export interface Configurable {
  configure(block: unknown): void;
}

export class PluginRegistry {
  private readonly plugins = new Map<string, () => Plugin>();
  private readonly notations = new Map<string, NotationHandler>();

  plugin(id: string, create: () => Plugin): this {
    this.plugins.set(id, create);
    return this;
  }

  notation(handler: NotationHandler): this {
    this.notations.set(handler.source, handler);
    return this;
  }

  create(id: string): Plugin {
    const create = this.plugins.get(id);
    if (!create) {
      throw new ShardError("config", `Unknown plugin "${id}"`, undefined, {
        details: [["available", [...this.plugins.keys()].join(", ") || "(none)"]],
      });
    }
    return create();
  }

  handler(source: string): NotationHandler {
    const handler = this.notations.get(source);
    if (!handler) {
      throw new ShardError("config", `Unknown dependency source "${source}"`, undefined, {
        details: [["supported", [...this.notations.keys()].join(", ") || "(none)"]],
      });
    }
    return handler;
  }

  helpers(): Record<string, unknown> {
    return Object.fromEntries([...this.notations.values()].map(h => [h.source, h.helper.bind(h)]));
  }
}

export interface InitOptions {
  readonly registry: PluginRegistry;
  readonly readers: readonly ConfigReader[];
  readonly defaultPlugins: readonly string[];
  readonly defines: readonly string[];
  readonly platform?: string;
  readonly arch?: string;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly listener?: InitListener;
  readonly dryRun?: boolean;
  readonly dependencies?: boolean;
}

export async function initialize(build: Build, options: InitOptions): Promise<Module> {
  const ctx = configContext(options);
  const listener = options.listener ?? {};
  const dryRun = options.dryRun ?? false;
  const byDir = new Map<string, Module>();
  const names = new Map<string, string>();
  let nextId = 0;

  const load = async (dir: string, via: DeclaredEdge | null, chain: readonly string[], declaredName?: string): Promise<Module> => {
    const real = realpathSync(dir);
    const known = byDir.get(real);
    if (known) return known;

    const isRoot = via === null && chain.length === 0;
    const name = declaredName ?? basename(real);
    const path = isRoot ? ":" : `:${name}`;
    const other = names.get(path);
    if (other && other !== real) {
      throw new ShardError("config", `Two different modules are named "${name}"`, "rename one of the directories", {
        details: [["first", other], ["second", real]],
      });
    }
    names.set(path, real);

    const { config, file } = await readConfig(real, options.readers, ctx);
    const module = build.addModule({ name, path, dir: real, buildDir: join(real, ".shard"), configFile: file });
    byDir.set(real, module);

    for (const id of config.plugins ?? options.defaultPlugins) module.plugins.apply(options.registry.create(id));

    const declared = options.dependencies === false && isRoot ? [] : scopes(config).flatMap(([scope, notations]) => {
      const configuration = module.configurations.findByName(scope);
      if (!configuration || configuration.role !== "scope") {
        throw new ShardError("config", `${module.path} declares dependencies in "${scope}", which no plugin provides`);
      }
      return notations.map(notation => ({ configuration, notation }));
    });
    const edges = declared.map(({ notation }): DeclaredEdge => ({
      id: nextId++,
      parentId: via?.id ?? null,
      notation,
      info: options.registry.handler(notation.source).describe(notation),
    }));
    if (edges.length > 0) listener.declared?.(module, edges);

    for (let i = 0; i < edges.length; i++) {
      const dep = await declare(edges[i]!, module, [...chain, name]);
      if (dep) declared[i]!.configuration.add(dep);
    }

    for (const [key, block] of Object.entries(config)) {
      if (key === "plugins" || key === "dependencies") continue;
      const ext = module.extensions.find<Partial<Configurable>>({ name: key });
      if (!ext?.configure) {
        throw new ShardError("config", `Unknown block "${key}" in ${file}`,
          "apply the plugin that provides it", { details: [["blocks", module.extensions.names().join(", ") || "(none)"]] });
      }
      ext.configure(block);
    }
    build.markInitialized(module);
    listener.loaded?.(module, via);
    return module;
  };

  const declare = async (edge: DeclaredEdge, from: Module, chain: readonly string[]): Promise<Dependency | null> => {
    const { notation } = edge;
    const attributes = Object.entries(notation.attributes ?? {})
      .reduce((all, [name, value]) => all.with(attribute<string>(name), value), AttributeContainer.empty());
    listener.start?.(edge);
    const startedAt = performance.now();
    let target: NotationTarget;
    try {
      target = await options.registry.handler(notation.source).resolve(notation, from, {
        requestedBy: chain,
        dryRun,
        onProgress: percent => listener.progress?.(edge, percent),
      });
      if (target.kind === "module" && !existsSync(target.dir) && !dryRun) {
        throw new ShardError("config", `Module not found: ${target.dir}`, undefined, { details: [["declared in", from.dir]] });
      }
    } catch (error) {
      if (!dryRun) throw error;
      listener.failed?.(edge, error);
      return null;
    }

    const duration = performance.now() - startedAt;
    if (target.kind === "missing") {
      listener.done?.(edge, { target, duplicate: false, duration });
      return null;
    }
    if (target.kind === "variants") {
      listener.done?.(edge, { target, duplicate: false, duration });
      return { kind: "variants", name: target.name, variants: target.variants, attributes };
    }
    if (!existsSync(target.dir)) {
      listener.done?.(edge, { target: { kind: "missing" }, duplicate: false, duration });
      return null;
    }
    const real = realpathSync(target.dir);
    listener.done?.(edge, { target, dir: real, duplicate: byDir.has(real), duration });
    const child = await load(target.dir, edge, chain, target.name);
    return moduleDependency(child.path, attributes);
  };

  return load(build.rootDir, null, []);
}

async function readConfig(dir: string, readers: readonly ConfigReader[], ctx: ConfigContext): Promise<{ config: ModuleConfig; file?: string }> {
  for (const reader of readers) {
    const config = await reader.read(dir, ctx);
    if (config) return { config, file: join(dir, reader.file) };
  }
  return { config: {} };
}

function scopes(config: ModuleConfig): [string, readonly DependencyNotation[]][] {
  const deps = config.dependencies;
  if (!deps) return [];
  return Array.isArray(deps) ? [["implementation", deps]] : Object.entries(deps);
}

function configContext(options: InitOptions): ConfigContext {
  const values = new Map(options.defines.map(d => {
    const eq = d.indexOf("=");
    return eq === -1 ? [d, ""] : [d.slice(0, eq), d.slice(eq + 1)];
  }));
  return {
    ...options.registry.helpers(),
    ...options.context,
    platform: options.platform ?? process.platform,
    arch: options.arch ?? process.arch,
    defines: options.defines,
    defined: name => values.has(name),
    define: name => values.get(name),
  };
}
