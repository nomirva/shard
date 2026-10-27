import { extension, ListProperty, Property, type Configurable } from "../../core";
import type { PathPatterns } from "../shard-json/manifest";
import { parseOptions } from "./options";
import type { CStandard, Profile, StandardOptions, Subsystem, WarningSet } from "./lang/types";
import { ShardError } from "../../utils/errors";
import { isPlainObject } from "../../utils/object";

export interface CBlock {
  kind?: "executable" | "library";
  sources?: PathPatterns;
  imports?: PathPatterns;
  exports?: PathPatterns;
  standard?: CStandard | { version?: CStandard; support?: CStandard; pedantic?: boolean | "error" };
  profile?: Profile;
  warnings?: WarningSet;
  defines?: string[];
  compileExtra?: string[];
  linkExtra?: string[];
  subsystem?: Subsystem;
  variant?: string;
}

const BLOCK_KEYS: readonly (keyof CBlock)[] = [
  "kind", "sources", "imports", "exports", "standard", "profile", "warnings",
  "defines", "compileExtra", "linkExtra", "subsystem", "variant",
];

export class CExtension implements Configurable {
  readonly kind: Property<"executable" | "library">;
  readonly sources: Property<PathPatterns>;
  readonly imports: Property<PathPatterns>;
  readonly exports: Property<PathPatterns>;
  readonly standard: Property<StandardOptions>;
  readonly profile: Property<Profile>;
  readonly warnings: Property<WarningSet>;
  readonly defines: ListProperty<string>;
  readonly compileExtra: Property<string[]>;
  readonly linkExtra: Property<string[]>;
  readonly subsystem: Property<Subsystem>;
  readonly variant: Property<string>;
  readonly generated: ListProperty<string>;

  constructor(owner: string) {
    const name = (field: string) => `${owner} c.${field}`;
    this.kind = new Property(name("kind"));
    this.sources = new Property(name("sources"));
    this.imports = new Property(name("imports"));
    this.exports = new Property(name("exports"));
    this.standard = new Property(name("standard"));
    this.profile = new Property(name("profile"));
    this.warnings = new Property(name("warnings"));
    this.defines = new ListProperty(name("defines"));
    this.compileExtra = new Property(name("compileExtra"));
    this.linkExtra = new Property(name("linkExtra"));
    this.subsystem = new Property(name("subsystem"));
    this.variant = new Property(name("variant"));
    this.generated = new ListProperty(name("generated"));
  }

  configure(raw: unknown): void {
    if (!isPlainObject(raw)) throw new ShardError("config", "The c block must be an object");
    const unknown = Object.keys(raw).filter(k => !(BLOCK_KEYS as readonly string[]).includes(k));
    if (unknown.length > 0) {
      throw new ShardError("config", `Unknown field${unknown.length > 1 ? "s" : ""} in the c block: ${unknown.join(", ")}`,
        undefined, { details: [["fields", BLOCK_KEYS.join(", ")]] });
    }
    const block = raw as CBlock;
    const options = parseOptions({
      profile: block.profile, standard: block.standard, warnings: block.warnings, defines: block.defines,
      compileExtra: block.compileExtra, linkExtra: block.linkExtra, subsystem: block.subsystem,
    });

    if (block.kind !== undefined) {
      if (block.kind !== "executable" && block.kind !== "library") {
        throw new ShardError("config", 'c.kind must be "executable" or "library"');
      }
      this.kind.set(block.kind);
    }
    if (block.sources !== undefined) this.sources.set(block.sources);
    if (block.imports !== undefined) this.imports.set(block.imports);
    if (block.exports !== undefined) this.exports.set(block.exports);
    if (options.standard !== undefined) this.standard.set(options.standard);
    if (options.profile !== undefined) this.profile.set(options.profile);
    if (options.warnings !== undefined) this.warnings.set(options.warnings);
    if (options.defines !== undefined) this.defines.addAll(options.defines);
    if (options.compileExtra !== undefined) this.compileExtra.set(options.compileExtra);
    if (options.linkExtra !== undefined) this.linkExtra.set(options.linkExtra);
    if (options.subsystem !== undefined) this.subsystem.set(options.subsystem);
    if (block.variant !== undefined) this.variant.set(block.variant);
  }
}

export const C = extension<CExtension>("c");
