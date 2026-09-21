# Shard Build Manager — Specification

> **Note:** This specification is partially outdated. It no longer fully matches
> the implementation (for example, shape detection and the set of package shapes /
> link types have diverged). Treat it as a reference only; to be reconciled later.

## 1 Scope

This document specifies the behaviour of the Shard build manager, its manifest format (`shard.json`), module layout conventions, and the command-line interface. It is intended for implementers and tool integrators.

Conformance language follows [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

## 2 Normative references

- ECMA-404 (JSON)
- SemVer 2.0.0
- IEEE 1003.1 (C standard)
- RFC 2119

## 3 Terms and definitions

**Module**
A directory containing a `shard.json` manifest, C sources, and optionally headers and prebuilt artefacts. Every module has exactly one shape.

**Root**  
The top-level module passed on the command line. Git dependencies are cloned into the root's `modules/` directory; build cache and artefacts live under `.shard/`.

**Dependency**
A module declared in the `depend` field. A dependency is resolved to a concrete path on disk, pointed to by a `Module` instance.

**Shape**
One of `executable`, `library` or `prebuilt`. Determined by automatic detection unless overridden by the manifest.

**Export**
A file or directory declared in the `exports` field. Exports are copied to `target/include/` after a build and made available to dependents as include paths.

**Toolchain**
A concrete compiler and linker implementation (currently Clang; the abstract interface is `Toolchain`).

**Target**
A triple describing the destination platform: `<arch>-<platform>[-<abi>]`.

**ABI**
The environment/libc identifier, e.g. `gnu`, `musl`, `msvc`, or `none` on darwin.

**Variant**
An optional string in the `target` field that produces a subdirectory below the ABI level in the artefact path.

## 4 Module layout

### 4.1 Executable

- MUST contain a `src/main.c` or a `main.c` path inside the `sources` field of the manifest.
- MAY have `include/` or declare `exports`.

### 4.2 Library

- MUST contain `src/` on disk or declare `sources` in the manifest.
- MAY have `include/` or declare `exports`.

### 4.3 Prebuilt

- MUST have `include/` on disk.
- MUST have `target/` on disk.
- MUST NOT have `src/` on disk and MUST NOT have `sources` in the manifest.

### 4.4 Shape detection

Shape is determined by the following algorithm, performed after manifest parsing:

```
if  disk has main.c  OR  manifest array-form sources include "main.c" → executable
elif  disk has include/ AND target/ AND no src/ AND no manifest sources → prebuilt
elif  disk has src/  OR  manifest has sources → library
else → error
```

Note: only the array form of `sources` is checked for `main.c`. Object-form sources (prefix + glob) do not trigger executable detection automatically.

## 5 Manifest (shard.json)

### 5.1 Grammar

```json
{
  "depend":     [ "<dependency>" ],
  "sources":    "<sources-field>",
  "imports":   "<imports-field>",
  "exports":    "<exports-field>",
  "target":     "<string>",
  "version":    "<semver>",
  "scripts":    { "<name>": "<command>" },
  "options": {
    "profile":    "<debug|debug-opt|release|fast|small|tiny>",
    "standard":   "<string>",
    "warnings":   "<none|default|extra|pedantic|all|error>",
    "defines":    [ "<string>" ],
    "compileExtra": [ "<string>" ],
    "linkExtra":    [ "<string>" ],
    "subsystem":  "<console|windows|native|efi_application>"
  },
  "?<variable>(:<value>|!<value>)": { ... },
}
```

Where:

```
<sources-field>  = [ "<path>" ] | { "<prefix>": [ "<glob>" ] }
<imports-field> = [ "<path>" ] | { "<prefix>": [ "<glob>" ] }
<exports-field>  = [ "<path>" ] | { "<prefix>": [ "<glob>" ] }
<glob>           = <path> | "*" | "**" | glob-pattern
```

Every field is optional. All paths are relative to the directory containing the manifest.

### 5.2 depend

A list of dependency URIs with the following grammar:

```
dependency = prefix ":" value [ link-modifier ]
link-modifier = "+static" | "+shared" | "+dynamic"
prefix = "sys" | "git" | "local" | "framework"
```

For `git`, the value is one of:

```
git-value = repo [ "@" ref ]                // plain repository
          | repo "//" subpackage [ "@" ref ] // monorepo sub-package (canonical)
          | repo [ "@" ref ] "//" subpackage // equivalent alternate form
repo = owner "/" name
ref = version tag or branch name
subpackage = path/to/package
```

The prefix is REQUIRED. Omitting it produces an error.

| Prefix | Value | Behaviour |
|--------|-------|-----------|
| `sys` | System library name | Passed as `-l<value>` |
| `framework` | Framework name (Apple) | Passed as `-Wl,-framework,<value>` |
| `local` | Path relative to parent module | Resolved via `Fetcher.local()` |
| `git` | Git URL | Cloned via `Fetcher.git()`; `.git` directory removed |

**Ref pinning** (git only):
- Append `@<ref>` to pin to a branch or tag (e.g. `git:user/repo@main`, `git:user/repo@v1.2.3`). Absent `@`, the repository is cloned at `HEAD`.
- The value after `@` is treated as a version tag if it is a valid SemVer; otherwise it is a branch ref and its version is `null`.
- The installed directory is named `<name>@<ref>` (or `<name>` for `HEAD`) and records the pinned state.
- Version compatibility: two versions are compatible if their `major` components are equal.
- A request for a newer compatible version upgrades the installed copy in-place.
- An incompatible major version produces an error; two distinct non-version pins (or a version pin vs a floating pin) produce an unresolvable error.

**Monorepo sub-packages** (git only):
- A monorepo uses namespaced tags per sub-package, so the ref is resolved relative to the sub-package. With `repo//subpackage@ref`, the repository is checked out at tag `<subpackage>/<ref>`; the canonical form is `git:owner/monorepo//libs/mylib@v1.0.0` (the alternate `git:owner/monorepo@v1.0.0//libs/mylib` is also accepted).
- The clone uses `git sparse-checkout` to retrieve only the specified subdirectory, then hoists its contents to the module root.

**Link modifier semantics**:
- `+static`: the dependency MUST be linked statically.
- `+shared` or `+dynamic`: the dependency MUST be linked as a shared library.
- Absent: the linker chooses the default (static for libraries that provide both).

### 5.3 sources

A list of file or directory paths, OR an object mapping prefix directories to glob pattern lists.

**Array form**:
```json
"sources": ["src/main.c", "src/utils"]
```
Each entry is a path relative to the module root. Directories are scanned recursively for `.c` files.

**Object form**:
```json
"sources": {
  "vendor/src": ["rcore.c", "rshapes.c", "rtext.c"],
  "vendor/src/external/glfw/include": ["*"]
}
```
Each key is a prefix directory relative to the module root. Each value is a list of glob patterns resolved relative to that prefix. Matched files and directories are compiled.

If a path in `sources` (array form) or a prefix directory (object form) points to a directory, that directory MUST also be added to the private include search path.

If `sources` is absent, the default directory `src/` is scanned.

### 5.4 exports

A list of file or directory paths, OR an object mapping prefix directories to glob pattern lists. Specifies the module's public API headers.

**Array form**:
```json
"exports": ["include", "src/api.h"]
```
Each element is a path relative to the module root. The first component is stripped during copy.

**Object form**:
```json
"exports": {
  "vendor/src": ["raylib.h", "raymath.h", "rlgl.h"],
  "vendor/include": ["uv.h", "uv"]
}
```
Each key is a prefix directory relative to the module root. Each value is a list of glob patterns resolved relative to that prefix. Matched files and directories are copied with the entire prefix stripped.

**Copy rules**:
- Array form: first path component is stripped; the remainder is preserved as the relative path under `include/`.
- Object form: the entire prefix key is stripped; the glob-matched relative path is preserved.
- Directories are copied recursively.
- Files that do not exist on disk are silently skipped.
- If `exports` is absent or empty, no headers are exported and `BuildResult.includePaths` MUST be empty.

`exports` controls only header publication: the copy step and the include path offered to dependents. It MUST NOT contribute to the module's own private include search path — to include its own exported headers during compilation a module declares them via `imports` or keeps them next to its sources.

**BuildResult.includePaths** pointing to dependents:
- MUST include the single path `<outBase>/target/<arch>/<platform>/<abi>[/<variant>]/include/`.

**Copy examples**:

| Form | Entry | Source on disk | Destination under `include/` |
|---|---|---|---|
| Array | `"include"` | `<mod>/include/api.h` | `api.h` |
| Array | `"include/api.h"` | `<mod>/include/api.h` | `api.h` |
| Array | `"src/raylib.h"` | `<mod>/src/raylib.h` | `raylib.h` |
| Array | `"src/internal/str.h"` | `<mod>/src/internal/str.h` | `internal/str.h` |
| Object | `{ "vendor/src": ["raylib.h"] }` | `<mod>/vendor/src/raylib.h` | `raylib.h` |
| Object | `{ "vendor/include": ["uv.h"] }` | `<mod>/vendor/include/uv.h` | `uv.h` |
| Object | `{ "vendor": ["src/raylib.h"] }` | `<mod>/vendor/src/raylib.h` | `src/raylib.h` |
| Object | `{ "vendor/include": ["uv"] }` | `<mod>/vendor/include/uv/` | `uv/` |

### 5.5 imports

A list of directory paths, OR an object mapping prefix directories to glob pattern lists. Declares include search directories for compilation.

**Array form**:
```json
"imports": ["vendor/include", "vendor/src"]
```
Each entry is added to the compiler's include search path (`-I`).

**Object form**:
```json
"imports": {
  "vendor/src": ["*.h"],
  "vendor/src/external/glfw/include": ["*"]
}
```
Each key is a directory path relative to the module root. The key is added to the compiler's include search path. The glob patterns are descriptive (document which headers are expected from that directory) and do not affect the `-I` flag.

The private include search path is formed by the directories that contain the module's own sources plus the `imports` directories. If `imports` is absent, only the source directories are used.

### 5.6 Glob patterns

The object form of `imports`, `sources`, and `exports` uses glob patterns with the following semantics:

- `*` matches any sequence of characters **within a single path segment** (no `/`). Example: `*.h` matches `raylib.h` but not `src/raylib.h`.
- `**` matches **zero or more whole path segments**. Example: `**/*.h` matches `raylib.h` and `src/utils/raylib.h`.
- A pattern with no glob characters (`*`, `**`) is an exact path match.
- Hidden files and directories (starting with `.`) are excluded from matching.
- Matching is performed against paths relative to the prefix directory.

### 5.7 target

An optional string. When present, the artefact is placed in a subdirectory named after this value below `target/<arch>/<platform>/<abi>/`.

Example: `"target": "debug"` → `target/arm64/darwin/none/debug/app`.

### 5.8 version

A SemVer 2.0.0 string. Used by `Fetcher.git()` to pin a dependency to a specific tag. Written to the installed module's `shard.json` after checkout.

### 5.9 options

| Field | Type | Behaviour |
|-------|------|-----------|
| `profile` | string | Compilation profile. Default `release`. See below. |
| `standard` | string \| object | Canonical C standard. String: equivalent to `{ "version": "<std>" }`. Object fields: `version` (canonical name), `support` (oldest standard a consumer of the exported headers may use), `pedantic` (`true` → `-Wpedantic`, `"error"` → `-pedantic-errors`). All fields are optional; an empty object adds no flags. See §5.12. |
| `warnings` | string | Maps to warning flags. |
| `defines` | `string[]` | Each entry passed as `-D<value>`. |
| `compileExtra` | `string[]` | Passed verbatim to the compiler. |
| `linkExtra` | `string[]` | Passed verbatim to the linker. |
| `subsystem` | string | Subsystem flag for the linker (Windows, EFI). |

**Compilation profiles.** A profile selects a preset of optimisation and debug settings. The name is toolchain-independent; the mapping to compiler flags is defined by the toolchain. For Clang:

| Profile | Flags |
|---------|-------|
| `debug` | `-O0 -g` |
| `debug-opt` | `-O2 -g` |
| `release` | `-O2` |
| `fast` | `-O3` |
| `small` | `-Os` |
| `tiny` | `-Oz` |

The `--profile <name>` CLI flag overrides the profile for the whole build, including modules that declare their own. Profiles affect compilation only, and are not inherited between modules.

### 5.10 scripts

A mapping of script names to shell commands. Each entry MAY reference a `preload`, `prebuild`, `postbuild` or `preclean` key, which are reserved as build or clean hooks (see §7.7). All other keys are arbitrary and MAY be invoked via `shard run <name>`.

Examples:

```json
{
  "scripts": {
    "test": "python run_tests.py",
    "lint": "clang-tidy src/*.c",
    "prebuild": "python gen_assets.py"
  }
}
```

### 5.11 Conditional configuration

Any key in `shard.json` prefixed with `?` is a conditional. The grammar:

```
?<variable>(:<value>|!<value>)
```

- `:value`: the block is active when `variable == value`.
- `!value`: the block is active when `variable != value`.

Conditional keys are resolved at manifest parse time against the following variables:

| Variable | Source |
|----------|--------|
| `platform` | `process.platform` (`"darwin"`, `"linux"`, `"win32"`) |
| `arch` | `process.arch` (`"x64"`, `"arm64"`, etc.) |
| `compiler` | `toolchain.name` (`"clang"`, etc.) |
| `define` | The `--def` CLI flag values |

For the `define` variable, a conditional `?define:X` matches if any `--def` value equals `X` exactly or starts with `X=`. For example, `--def NODEBUG` activates `?define:NODEBUG`, and `--def VERSION=5` activates both `?define:VERSION` and any conditional checking `VERSION` as a defined name.

A conditional block that evaluates to an object is deep-merged with the base object and with other matching conditionals. Arrays from matching conditionals are concatenated. Conditionals defined later in the document have higher priority during merge.

### 5.12 Standard compatibility

Canonical C standard names are `c89`, `c99`, `c11`, `c17`, `c23` and the GNU dialects `gnu89`, `gnu99`, `gnu11`, `gnu17`, `gnu23`. Only these names are accepted; aliases such as `c90`, `c2x`, `gnu90`, `gnu2x` are errors. C++ is not supported and any C++ standard name is an error. The mapping from a canonical name to a compiler flag is a toolchain concern and is not part of the manifest.

`standard.version` declares the standard used to compile a module. `standard.support` declares the oldest standard that a consumer of the module's exported headers may use; it is optional and defaults to `effective(B)` (the module's own standard). Both must be canonical names.

**Inheritance.** A module that does not declare `version` inherits the effective standard of the modules that depend on it, transitively up to the root. If the root declares no version, no `-std` flag is passed and no compatibility checks apply. When a module is reachable through several paths that inherit different standards, the oldest standard wins (C versions are backwards compatible); for the same version the pure `c` dialect is preferred over the corresponding `gnu` dialect.

**Header compatibility.** Let `baselines(B) = { effective(B) } ∪ { support(B) }`. When a module `A` depends, directly or transitively, on a module `B` that exports headers, the build fails unless some baseline `s ∈ baselines(B)` is covered by `A`:

```
rank(version_A) ≥ rank(s)   and   (s is pure `c`  or  A uses a `gnu` dialect)
```

Because C is backwards compatible, a pure-`c` header is usable by newer and by `gnu` consumers; a `gnu` header is usable only by `gnu` consumers at the same or a newer version. A `support` older than `version` broadens the set of accepted consumers. Modules without exported headers are not checked.

## 6 Dependency resolution

### 6.1 URI schemes

| Scheme | Operation |
|--------|-----------|
| `sys` | No installation; linker flag created. |
| `local` | Resolved to an absolute path via `Fetcher.local()`. |
| `git` | Cloned into `<root>/modules/<name>[@<ref>]/`, `.git` directory removed. The directory name encodes the pinned state: no suffix for `HEAD`, `@<ref>` for a branch or version tag (e.g. `git:user/repo@main` → `<name>@main`, `git:user/repo@v1.2.3` → `<name>@v1.2.3`). A monorepo sub-package is specified via `repo//<subpath>[@<ref>]` (e.g. `git:user/monorepo//libs/mylib@v1.0.0`), cloned with sparse checkout. |
| `framework` | No installation; linker flag created (`-Wl,-framework,<value>`). |

### 6.2 Link type modifiers

If a dependency declares `+static`, `+shared`, or `+dynamic`, the link type is treated as a hint. The actual link type used is determined by the availability at resolution time; a mismatch produces a warning but does not fail the build.

### 6.3 Version compatibility

A module is installed in exactly one pinned state per name; C is statically linked, so two copies of one package cannot coexist. The requested pin is compared against the installed state derived from the `modules/` directory name:

- Two requests pinning the same value (including two identical `HEAD` requests) reuse the installed copy.
- A request with no semver version (branch/ref or `HEAD`) conflicting with a different floating pin or a version tag produces an unresolvable error.
- A version tag vs a floating pin produces an unresolvable error.
- Two version tags with differing major versions produce an error. Within the same major version, the newer version replaces the older (the installed copy is upgraded in-place).

## 7 Build

### 7.1 Lifecycle

A build invocation proceeds in the following order:

1. Manifest loading: manifests are parsed and dependency lists are constructed.
2. Dependency sync (`update()`): all transitive dependencies are installed (fetched) and their manifests loaded.
3. Materialization: for each module in dependency order, the `preload` hook runs (if defined) and the module's files are scanned, fixing its content and shape.
4. Recursive build: each dependency is built before its consumer. Before compilation, the `prebuild` hook is executed (if defined). After linking but before returning the result, `postbuild` is executed (if defined).
5. Export copying: exports are copied to the target include directory (after `prebuild`, before `postbuild`).
6. Linking or archiving.

### 7.2 Compilation

The include search path for compilation is formed by concatenating:

1. Include paths from each dependency's `BuildResult.includePaths`.
2. Directory-only entries from the module's own `imports` field (if present).
3. The directories containing the module's own source files.

Items 2–3 constitute the **private include paths**. Private paths MUST NOT be exposed via `BuildResult.includePaths`. `exports` entries are never added here; they only feed the copy step and dependent include paths.

### 7.3 Linking and archiving

When linking a root library module, both static and shared artefacts MUST be produced regardless of the requested link type. The `BuildResult` for the root records the primary (requested) artefact.

### 7.4 Export copying

After linking (or after prebuilt detection), the export copy step runs if `exports` is present and non-empty.

**Array form**: for each string entry:
1. Resolve `<module-root>/<entry>`.
2. Strip the first path component → relative suffix.
3. Copy to `target/include/<suffix>`.

**Object form**: for each `[prefix, patterns]` pair:
1. Resolve `<module-root>/<prefix>`.
2. For each glob pattern, expand matched paths relative to prefix.
3. Each matched path is copied to `target/include/<matched-path>` (entire prefix stripped).

The resulting `BuildResult.includePaths` MUST be set to `[<outBase>/target/.../include/]`.

### 7.5 Target directory structure

The output directory for build artefacts is:

```
<outBase>/target/<arch>/<platform>/<abi>[/<variant>]/
```

Where:
- `outBase` = module root path for root modules, `.shard/<name>` for dependencies.
- `arch` and `platform` are the host architecture and operating system as reported by the runtime.
- `abi` is detected from the toolchain's target triple. On darwin it is always `"none"`.
- `variant` is the value of the `target` field in the manifest, if present.

### 7.6 ABI detection

At toolchain initialisation (`detect()`) the output of `clang --version` is parsed:

- The first line is stored as `version`.
- The `Target:` line is split on `-`. The last component is the ABI:
  - `"gnu"`, `"musl"`, `"msvc"` are used as-is.
  - Any other value (or a three-component triple) produces `"none"`.
- On `win32`, only the GNU/MinGW variant (ABI `"gnu"`) is supported; all other ABIs cause detection to fail.

### 7.7 Build hooks

A module MAY declare `preload`, `prebuild`, `postbuild` and `preclean` scripts in `scripts`:

- `preload`: executed after the manifest is parsed and before the module's files are scanned. Intended for code generation that produces source or header files; the generated files are discovered by the subsequent scan.
- `prebuild`: executed after include paths are resolved and before compilation. Runs before individual compile tasks, after the dependency build loop.
- `postbuild`: executed after export copying and `BuildResult.includePaths` assignment, before the result is returned to the parent.
- `preclean`: executed at the start of `shard clean`, before any filesystem removal. If it fails, the cleaning operation is aborted.

All hooks run via `spawnSync` with `shell: true` and their working directory set to the module root. A non-zero exit from any hook aborts the current operation.

## 8 Cache

### 8.1 Storage format

Cache entries are stored as a JSON dictionary at `<root>/.shard/cache.json`. Each key is a slash-separated path `{moduleName}/{relPath}`. Each value is the SHA-256 hash of the source and its transitive dependencies at the time of compilation.

### 8.2 Invalidation

A compilation pass is skipped (cache hit) when the stored hash matches the current hash of:

1. The `.c` source file.
2. Every header file reachable via `#include` directives, obtained by parsing the compiler dependency file (`.d`).
3. The compile options object.

The hash is computed using SHA-256.

### 8.3 Modes

| Mode | Behaviour |
|------|-----------|
| `0` | Cache enabled for all modules. |
| `1` | Cache disabled for the root module; enabled for dependencies. |
| `2` | Cache disabled entirely. |

## 9 CLI

### 9.1 `shard build`

Build a module. Synopsis:

```
shard build [<path>] [--ignore-cache <0|1|2>] [--def <names...>] [--profile <name>] [--start] [--git-protocol <protocol>]
```

- `<path>` defaults to `.` (current directory).
- `--def` passes defines; each definition is split on `,` and each token is available as `?define:` conditionals.
- `--ignore-cache` controls cache mode.
- `--profile` selects the compilation profile for the whole build, overriding per-module `options.profile` (see §5.9).
- `--start` builds and runs the resulting executable.
- `--git-protocol` selects the git protocol for dependency cloning: `https` (default), `ssh`, or `http`. May also be set via the `SHARD_GIT_PROTOCOL` environment variable.

### 9.2 `shard info`

Display module metadata. Synopsis:

```
shard info <path>
```

Prints name, type, include paths, and dependencies.

### 9.3 `shard update`

Install or update all transitive dependencies without compilation. Synopsis:

```
shard update [<path>]
```

Removes stale module directories (those not reachable from any active dependency declaration). On completion, prints the count of installed dependency modules.

### 9.4 `shard clean`

Remove build cache (`.shard/`), installed dependencies (`modules/`), and build artefacts (`target/`). Synopsis:

```
shard clean [<path>]
```

### 9.5 `shard run`

Execute a script from the module manifest. Synopsis:

```
shard run <script> [<path>]
```

- `<script>` (required): a key from the `scripts` field in `shard.json`.
- `<path>` defaults to `.` (current directory).

The script is executed via `spawnSync` with `shell: true` from the module root directory. If the script is not defined or exits with a non-zero status, the command exits with code `1`.

### 9.6 `shard doctor`

Check toolchain availability. Synopsis:

```
shard doctor
```

Prints status by category (`[Toolchain]`, `[Version Control]`). Exits with code `0` when all checks pass, code `1` otherwise.

### 9.7 Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Build/compatibility/usage error |

## 10 Conformance

A conforming implementation of Shard MUST:

- Parse the manifest according to section 5.
- Resolve dependencies according to section 6.
- Build according to section 7.
- Implement the cache described in section 8.
- Provide the CLI described in section 9.

This document is not prescriptive about the internal architecture (class hierarchy, module structure) as long as the external behaviour matches the specification.
