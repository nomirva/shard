import { existsSync, realpathSync } from "fs";
import { basename, join } from "path";
import { ShardError } from "../utils/errors";
import { attribute, AttributeContainer } from "./attributes";
import type { Build } from "./build";
import type { Dependency, OutgoingVariant } from "./configurations";
import { moduleDependency } from "./configurations";
import type { Module, Plugin } from "./module";

/**
 * A dependency as written in a config: plain data, so `shard.ts` and a future
 * `shard.json` describe it the same way. `attributes` refine what the edge
 * asks for, e.g. `{ linkage: "shared" }`.
 */
export interface DependencyNotation {
  readonly source: string;
  readonly attributes?: Readonly<Record<string, string>>;
  readonly [field: string]: unknown;
}

/** How a dependency was satisfied, for the report: "installed", "upgraded", "linked", ... */
export interface ResolutionNote {
  readonly action: string;
  /** Version replaced by an upgrade. */
  readonly previous?: string;
  /** Link flags a system library turned into. */
  readonly flags?: readonly string[];
  readonly warnings?: readonly string[];
}

/** What a notation points at once the module declaring it is known. */
export type NotationTarget =
  /** `name` defaults to the directory name (a git checkout "lib@v1.2.0" is module "lib"). */
  | { readonly kind: "module"; readonly dir: string; readonly name?: string; readonly note?: ResolutionNote }
  | { readonly kind: "variants"; readonly name: string; readonly variants: readonly OutgoingVariant[]; readonly note?: ResolutionNote }
  /** Only in a dry run: the module would have to be fetched first. */
  | { readonly kind: "missing" };

/** How a dependency reads in reports: `gitlib  git  v1.2.0  shared`. */
export interface NotationInfo {
  readonly name: string;
  readonly source: string;
  readonly spec: string;
  readonly link: string | null;
}

export interface ResolveOptions {
  /** Module names from the root down to the declaring module. */
  readonly requestedBy: readonly string[];
  /** Decide only: nothing is fetched or installed. */
  readonly dryRun: boolean;
  readonly onProgress: (percent: number) => void;
}

/** A dependency source contributed by a plugin package: `local(...)`, later `git(...)`, `sys(...)`. */
export interface NotationHandler {
  readonly source: string;
  /** The helper configs call, e.g. `local("../lib", { linkage: "shared" })`. */
  helper(...args: never[]): DependencyNotation;
  describe(notation: DependencyNotation): NotationInfo;
  resolve(notation: DependencyNotation, from: Module, options: ResolveOptions): NotationTarget | Promise<NotationTarget>;
}

/** One declared dependency edge; ids are unique within a build. */
export interface DeclaredEdge {
  readonly id: number;
  /** The edge that led to the declaring module; null for the root's own dependencies. */
  readonly parentId: number | null;
  readonly notation: DependencyNotation;
  readonly info: NotationInfo;
}

export interface ResolvedEdge {
  readonly target: NotationTarget;
  /** The module the edge leads to, for module targets. */
  readonly dir?: string;
  /** That module was already reached through another edge. */
  readonly duplicate: boolean;
  readonly duration: number;
}

/** Follows initialization: the resolve phase of the progress report, `shard info`. */
export interface InitListener {
  /** All dependencies of a module, before the first is resolved. */
  declared?(module: Module, edges: readonly DeclaredEdge[]): void;
  start?(edge: DeclaredEdge): void;
  progress?(edge: DeclaredEdge, percent: number): void;
  done?(edge: DeclaredEdge, result: ResolvedEdge): void;
  /** Only in a dry run, where a failing edge does not stop initialization. */
  failed?(edge: DeclaredEdge, error: unknown): void;
  /** A module's config has been applied. */
  loaded?(module: Module, via: DeclaredEdge | null): void;
}

/** One module's config after evaluation. Every other key is a block for the extension of that name. */
export interface ModuleConfig {
  readonly plugins?: readonly string[];
  /** A list goes to the `implementation` scope; an object names scopes. */
  readonly dependencies?: readonly DependencyNotation[] | Readonly<Record<string, readonly DependencyNotation[]>>;
  readonly [block: string]: unknown;
}

/** What a config function sees: the host and `--def` values, plus every dependency helper. */
export interface ConfigContext {
  readonly platform: string;
  readonly arch: string;
  readonly defines: readonly string[];
  /** `--def NAME` or `--def NAME=value` was passed. */
  defined(name: string): boolean;
  /** The value of `--def NAME=value`; "" for `--def NAME`. */
  define(name: string): string | undefined;
  readonly [helper: string]: unknown;
}

/** Reads a module's config file; null when the directory has none of this format. */
export interface ConfigReader {
  readonly file: string;
  read(dir: string, ctx: ConfigContext): Promise<ModuleConfig | null>;
}

/** An extension that accepts its config block, e.g. `c: { standard: "c11" }`. */
export interface Configurable {
  configure(block: unknown): void;
}

/** Plugins by id and dependency sources by name: what configs may refer to. */
export class PluginRegistry {
  private readonly plugins = new Map<string, () => Plugin>();
  private readonly notations = new Map<string, NotationHandler>();

  /** `create` makes a fresh instance per module. */
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
  /** Applied when a config does not list `plugins`. */
  readonly defaultPlugins: readonly string[];
  readonly defines: readonly string[];
  readonly platform?: string;
  readonly arch?: string;
  /** More values for configs, e.g. `compiler` once the CLI knows the toolchain. */
  readonly context?: Readonly<Record<string, unknown>>;
  readonly listener?: InitListener;
  /** Resolve without fetching; failures are reported, not thrown (`shard info`). */
  readonly dryRun?: boolean;
  /** false: load the root module only, without declaring dependencies (`shard run`, `shard clean`). */
  readonly dependencies?: boolean;
}

/**
 * The initialization pass: reads the root module's config, applies its
 * plugins, declares its dependencies and does the same for every module they
 * point at. Each directory becomes one module, however many edges reach it.
 */
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
