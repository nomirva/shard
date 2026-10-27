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

/** What a notation points at once the module declaring it is known. */
export type NotationTarget =
  | { readonly kind: "module"; readonly dir: string }
  | { readonly kind: "variants"; readonly name: string; readonly variants: readonly OutgoingVariant[] };

/** A dependency source contributed by a plugin package: `local(...)`, later `git(...)`, `sys(...)`. */
export interface NotationHandler {
  readonly source: string;
  /** The helper configs call, e.g. `local("../lib", { linkage: "shared" })`. */
  helper(...args: never[]): DependencyNotation;
  resolve(notation: DependencyNotation, from: Module): NotationTarget | Promise<NotationTarget>;
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
}

/**
 * The initialization pass: reads the root module's config, applies its
 * plugins, declares its dependencies and does the same for every module they
 * point at. Each directory becomes one module, however many edges reach it.
 */
export async function initialize(build: Build, options: InitOptions): Promise<Module> {
  const ctx = configContext(options);
  const byDir = new Map<string, Module>();
  const names = new Map<string, string>();

  const load = async (dir: string, isRoot: boolean): Promise<Module> => {
    const real = realpathSync(dir);
    const known = byDir.get(real);
    if (known) return known;

    const name = basename(real);
    const path = isRoot ? ":" : `:${name}`;
    const other = names.get(path);
    if (other && other !== real) {
      throw new ShardError("config", `Two different modules are named "${name}"`, "rename one of the directories", {
        details: [["first", other], ["second", real]],
      });
    }
    names.set(path, real);

    const config = await readConfig(real, options.readers, ctx);
    const module = build.addModule({ name, path, dir: real, buildDir: join(real, ".shard") });
    byDir.set(real, module);

    for (const id of config.plugins ?? options.defaultPlugins) module.plugins.apply(options.registry.create(id));

    for (const [scope, notations] of scopes(config)) {
      const configuration = module.configurations.findByName(scope);
      if (!configuration || configuration.role !== "scope") {
        throw new ShardError("config", `${module.path} declares dependencies in "${scope}", which no plugin provides`);
      }
      for (const notation of notations) {
        configuration.add(await declare(notation, module));
      }
    }

    for (const [key, block] of Object.entries(config)) {
      if (key === "plugins" || key === "dependencies") continue;
      const ext = module.extensions.find<Partial<Configurable>>({ name: key });
      if (!ext?.configure) {
        throw new ShardError("config", `Unknown block "${key}" in ${join(real, options.readers[0]?.file ?? "")}`,
          "apply the plugin that provides it", { details: [["blocks", module.extensions.names().join(", ") || "(none)"]] });
      }
      ext.configure(block);
    }
    return module;
  };

  const declare = async (notation: DependencyNotation, from: Module): Promise<Dependency> => {
    const attributes = Object.entries(notation.attributes ?? {})
      .reduce((all, [name, value]) => all.with(attribute<string>(name), value), AttributeContainer.empty());
    const target = await options.registry.handler(notation.source).resolve(notation, from);
    if (target.kind === "variants") return { kind: "variants", name: target.name, variants: target.variants, attributes };
    if (!existsSync(target.dir)) {
      throw new ShardError("config", `Module not found: ${target.dir}`, undefined, { details: [["declared in", from.dir]] });
    }
    const child = await load(target.dir, false);
    return moduleDependency(child.path, attributes);
  };

  return load(build.rootDir, true);
}

async function readConfig(dir: string, readers: readonly ConfigReader[], ctx: ConfigContext): Promise<ModuleConfig> {
  for (const reader of readers) {
    const config = await reader.read(dir, ctx);
    if (config) return config;
  }
  return {};
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
    platform: options.platform ?? process.platform,
    arch: options.arch ?? process.arch,
    defines: options.defines,
    defined: name => values.has(name),
    define: name => values.get(name),
  };
}
