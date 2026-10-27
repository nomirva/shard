import type { LinkType, Profile, StandardOptions, Subsystem, WarningSet } from "../lang/types";
import type { TargetPlatform } from "./target";

/**
 * A toolchain is assembled from independent parts rather than inherited:
 * a new compiler reuses whichever parts match (naming, depfile tracking, ...)
 * and provides only what differs.
 */
export interface Toolchain {
  readonly name: string;
  readonly version: string;
  readonly target: TargetPlatform;
  readonly naming: ArtifactNaming;
  readonly compiler: CompilerDriver;
  readonly linker: LinkerDriver;
  readonly linkInputs: LinkInputTranslator;
  readonly deps: DependencyTracker;
}

/** Detects one kind of toolchain on the host. */
export interface ToolchainProvider {
  readonly name: string;
  /** How to install it, shown by `shard doctor`. */
  readonly installHint?: string;
  detect(): Toolchain | null;
}

/** A process call described as data; build/runner.ts executes it. */
export interface Invocation {
  readonly tool: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  /** stream: async, diagnostics go straight to stderr; capture: sync, output becomes the error hint. */
  readonly io: "stream" | "capture";
}

export interface ArtifactNaming {
  readonly staticLibExt: string;
  readonly sharedLibExt: string | null;
  readonly exeExt: string | null;
}

export interface CompileOptions {
  includePaths: string[];
  profile?: Profile;
  standard?: StandardOptions;
  warnings?: WarningSet;
  defines?: string[];
  extra?: string[];
}

export interface CompileTask {
  source: string;
  object: string;
  options: CompileOptions;
}

export interface LinkTask {
  kind: "executable" | "shared";
  objects: string[];
  output: string;
  libPaths: string[];
  libFlags: string[];
  subsystem?: Subsystem;
  extra?: string[];
}

export interface ArchiveTask {
  objects: string[];
  output: string;
}

export interface CompilerDriver {
  compile(task: CompileTask, cwd: string): Invocation;
}

export interface LinkerDriver {
  link(task: LinkTask): Invocation;
  archive(task: ArchiveTask): Invocation;
}

/** A toolchain-neutral request to link against something provided by the system. */
export interface LinkInput {
  kind: "library" | "framework";
  name: string;
  link: LinkType | null;
}

export interface LinkFlags {
  flags: string[];
  warnings: string[];
}

export interface LinkInputTranslator {
  translate(input: LinkInput): LinkFlags;
}

/** Knows how a compiler reports the headers a translation unit depends on. */
export interface DependencyTracker {
  compileFlags(object: string): string[];
  dependencies(object: string): string[];
}
