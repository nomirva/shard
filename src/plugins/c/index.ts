import { join } from "path";
import {
  LifecycleTask, provider, type Artifact, type Module, type Plugin, type Provider, type TaskProvider,
} from "../../core";
import { cacheEnabled } from "../../cache/cache";
import { processRunner } from "../../build/runner";
import type { CStandard, StandardOptions } from "../../lang/types";
import type { CompileOptions } from "../../toolchain/toolchain";
import { privateIncludes } from "../../target/content";
import { PackageShape } from "../../target/shape";
import { sharedLibPath, staticLibPath } from "../../workspace/artifacts";
import { C, CExtension } from "./extension";
import { cModel, optional, type CModel } from "./model";
import { ARTIFACT, C_PARAMETERS, C_RUNNER, C_TOOLCHAIN, DEFAULT_PARAMETERS, LINKAGE, type CParameters } from "./services";
import { C_MODULES, CModules } from "./modules";
import { CArchive, CCompile, CLink, CopyHeaders, objectPath, type RuntimeLib } from "./tasks";

export { C, CExtension, type CBlock } from "./extension";
export * from "./services";
export { C_MODULES, CModules } from "./modules";
export { CArchive, CCompile, CLink, CopyHeaders } from "./tasks";

const LINKAGES = ["static", "shared"] as const;

/**
 * Builds C modules. Registers the `c` block, the `implementation` scope and
 * the tasks compile → archive / linkShared / link, plus `assemble`. A library
 * publishes a static and a shared variant; consumers pick one by `linkage`,
 * and only the tasks behind the chosen variants run.
 */
export function cPlugin(): Plugin {
  return { id: "c", apply };
}

function apply(module: Module): void {
  if (!module.schema.isDefined(LINKAGE)) {
    module.schema.define(LINKAGE, {
      disambiguate: (requested, offered) => (requested ? [requested] : offered.filter(v => v === "static")),
      // One module links one way in a build: shared as soon as any edge asks for it.
      unify: requested => (requested.includes("shared") ? "shared" : "static"),
    });
  }

  const ext = module.extensions.add(C, new CExtension(module.path));
  const toolchain = () => module.services.get(C_TOOLCHAIN, "apply a toolchain plugin, e.g. clang");
  const params = () => module.services.find(C_PARAMETERS) ?? DEFAULT_PARAMETERS;
  const model = cModel(module, ext, toolchain);
  const isRoot = module.path === ":";

  const implementation = module.configurations.scope("implementation");
  const classpath = module.configurations.resolvable("compileClasspath").extendsFrom(implementation);
  const modules = module.services.getOrRegister(C_MODULES, () => new CModules());
  modules.add({ module, ext, classpath, model });
  /** Values of one artifact type from dependencies, depth-first in declaration order, each once. */
  const inherited = (type: string) =>
    classpath.incoming.artifacts(type, "declaration").map(list => [...new Set(list.map(a => a.value))]);

  const tool = (task: CCompile | CArchive | CLink) => {
    const tc = toolchain();
    task.toolchain = tc;
    task.runner = module.services.find(C_RUNNER) ?? processRunner;
    task.toolchainId.set(`${tc.name} ${tc.version}`);
    task.label = module.name;
  };

  const compile = module.tasks.register("compile", CCompile, t => {
    tool(t);
    t.sources.addAll(model.map(m => m.content.sources.map(u => u.path)));
    t.includeDirs.addAll(inherited(ARTIFACT.INCLUDE_DIR).zip(model, (dirs, m) =>
      [...dirs, ...privateIncludes(module.dir, { imports: optional(ext.imports) }, m.content)]));
    t.options.set(model.map(() => compileSettings(ext, params(), modules.effective(module))));
    t.objectDir.set(model.map(m => m.layout.objectDir));
    const useCache = cacheEnabled(params().cacheMode, isRoot);
    t.incremental.set(useCache);
    // --ignore-cache recompiles every file, even when the task as a whole looks up to date.
    t.alwaysRun = !useCache;
    t.objects.addAll(model.map(m => m.content.sources.map(u => objectPath(module.dir, m.layout.objectDir, u.path))));
  });
  const objects = compile.flatMap(t => t.objects);

  const archive = module.tasks.register("archive", CArchive, t => {
    tool(t);
    t.objects.addAll(objects);
    t.file.set(model.map(m => staticLibPath(module.name, m.layout, toolchain().naming)));
  });

  const linkInputs = (t: CLink, kind: "executable" | "shared") => {
    tool(t);
    t.kind.set(kind);
    t.objects.addAll(objects);
    t.libFiles.addAll(inherited(ARTIFACT.LINK_FILE));
    t.libFlags.addAll(classpath.incoming.artifacts(ARTIFACT.LINK_FLAG, "declaration").map(list => list.map(a => a.value)));
    t.extra.set(model.map(() => ({ subsystem: optional(ext.subsystem), extra: optional(ext.linkExtra) })));
  };

  const linkShared = module.tasks.register("linkShared", CLink, t => {
    linkInputs(t, "shared");
    t.file.set(model.map(m => sharedLibPath(module.name, m.layout, toolchain().naming) ?? join(m.layout.outDir, module.name)));
    if (!toolchain().naming.sharedLibExt) {
      t.unsupported.set(`Shared libraries not supported on platform "${toolchain().target.platform}"`);
    }
  });

  const link = module.tasks.register("link", CLink, t => {
    linkInputs(t, "executable");
    t.file.set(model.map(m => join(m.layout.outDir, `${module.name}${toolchain().naming.exeExt ?? ""}`)));
    t.runtime.addAll(classpath.incoming.artifacts(undefined, "declaration").map(runtimeLibs));
  });

  const copyHeaders = module.tasks.register("copyHeaders", CopyHeaders, t => {
    const entries = model.map(m => m.content.exports.map(e => ({ source: e.unit.path, dest: join(m.layout.includeDir, e.dest) })));
    t.entries.set(entries);
    t.sources.addAll(entries.map(list => list.map(e => e.source)));
    t.files.addAll(entries.map(list => list.map(e => e.dest)));
  });

  const tasks = { archive, linkShared, copyHeaders };
  for (const linkage of LINKAGES) {
    module.configurations.consumable(linkage === "static" ? "linkStatic" : "linkShared")
      .attribute(LINKAGE, linkage)
      .extendsFrom(implementation)
      .artifacts.addAll(model.flatMap(m => published(m, linkage, module.name, tasks, toolchain().naming.sharedLibExt)));
  }

  module.tasks.register("assemble", LifecycleTask, t => {
    t.description = "Builds the module's outputs";
    t.dependsOn(model.flatMap(m => {
      const wanted: Provider<unknown>[] = [];
      if (m.content.exports.length > 0) wanted.push(copyHeaders);
      if (m.shape === PackageShape.Executable) wanted.push(link);
      // A root library is always produced in both flavours.
      if (m.shape === PackageShape.Library) wanted.push(archive, ...(isRoot ? [linkShared] : []));
      return all(wanted);
    }));
  });
}

/** Effective compile settings: command line over the c block over defaults. */
function compileSettings(ext: CExtension, params: CParameters, effective: CStandard | undefined): Omit<CompileOptions, "includePaths"> {
  const own = optional(ext.standard);
  const version = effective ?? own?.version;
  const standard: StandardOptions | undefined = version !== undefined || own?.pedantic !== undefined
    ? { version, pedantic: own?.pedantic, support: own?.support }
    : undefined;
  return {
    profile: params.profile ?? optional(ext.profile),
    standard,
    warnings: optional(ext.warnings),
    defines: [...ext.defines.get(), ...params.defines],
    extra: optional(ext.compileExtra),
  };
}

/** What one variant of a module offers consumers: headers, the file to link, the runtime library. */
function published(
  m: CModel,
  linkage: (typeof LINKAGES)[number],
  name: string,
  tasks: { archive: TaskProvider<CArchive>; linkShared: TaskProvider<CLink>; copyHeaders: TaskProvider<CopyHeaders> },
  sharedExt: string | null,
): Provider<Artifact[]> {
  const parts: Provider<Artifact[]>[] = [];
  if (m.content.exports.length > 0) {
    parts.push(tasks.copyHeaders.map(() => [{ type: ARTIFACT.INCLUDE_DIR, value: m.layout.includeDir }]));
  }
  if (m.shape === PackageShape.Library) {
    const file = (linkage === "static" ? tasks.archive : tasks.linkShared).flatMap(t => t.file);
    parts.push(file.map(value => [{ type: ARTIFACT.LINK_FILE, value }]));
    // Built shared libraries ship only if they exist; the static variant must not build one for that.
    const shared = linkage === "shared" ? tasks.linkShared.flatMap(t => t.file) : provider(join(m.layout.outDir, `${name}${sharedExt}`));
    if (sharedExt) parts.push(shared.map(value => [{ type: ARTIFACT.RUNTIME_IF_BUILT, value }]));
  }
  if (m.shape === PackageShape.Prebuilt) {
    const lib = m.content.artifacts.find(u => u.isArtifact)?.path;
    const shared = sharedExt ? m.content.artifacts.find(u => u.ext === sharedExt)?.path : undefined;
    const files: Artifact[] = [];
    if (lib) files.push({ type: ARTIFACT.LINK_FILE, value: lib });
    if (shared) files.push({ type: ARTIFACT.RUNTIME, value: shared });
    parts.push(provider(files));
  }
  return all(parts).map(lists => lists.flat());
}

function runtimeLibs(artifacts: Artifact[]): RuntimeLib[] {
  const out: RuntimeLib[] = [];
  for (const a of artifacts) {
    if (a.type !== ARTIFACT.RUNTIME && a.type !== ARTIFACT.RUNTIME_IF_BUILT) continue;
    if (!out.some(lib => lib.path === a.value)) out.push({ path: a.value, ifExists: a.type === ARTIFACT.RUNTIME_IF_BUILT });
  }
  return out;
}

/** One provider of all values; depends on every producer behind them. */
function all<T>(providers: readonly Provider<T>[]): Provider<T[]> {
  return providers.reduce<Provider<T[]>>((acc, p) => acc.zip(p, (list, v) => [...list, v]), provider<T[]>([]));
}
