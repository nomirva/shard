# Architecture

shard is a small core that knows modules, tasks, lazy values and plugins, and
a set of plugins that teach it C. The model follows Gradle: a new feature is a
plugin or a task type, not a change to the core.

```
src/
  core/        modules, tasks, providers, configurations and attributes, graph, executor, initialization
  plugins/     c, clang, local, system, git, scripts, codegen, shard-json
  cli/         commands; turns core events into the console report
  report/      the event types plugins and the CLI share
  utils/
```

The core imports nothing outside `core/` and `utils/`.

## Three passes

1. **Initialization** (`core/init.ts`). The root module's config is read
   (`shard.ts`, else `shard.json`), its plugins are applied, its dependencies
   are declared. Each dependency notation (`local(...)`, `git(...)`,
   `sys(...)`) is resolved by the plugin that owns it, which may fetch it; a
   module it points at is loaded the same way. One directory is one module.
2. **Configuration**. Every module is initialized; `onConfigured` actions run
   in dependency order (the `preload` hook). The task graph is then built
   from the requested task (`assemble`): only reachable tasks are created,
   their properties are resolved and frozen.
3. **Execution** (`core/executor.ts`). Up to `--jobs` tasks run at once, each
   after its dependencies succeeded. A task whose fingerprint (declared
   inputs, plus files it discovered last time, such as headers from a
   depfile) is unchanged and whose outputs exist is up to date and skipped.

## Core entities

| Entity | Role |
|---|---|
| `Module` | One directory of the build. Holds `tasks`, `configurations`, `extensions`, `plugins`; cannot reach other modules. |
| `Task` | A unit of work with declared inputs and outputs. Gets its own paths, never the module. |
| `Provider` / `Property` | Lazy values that remember which tasks produce them. Wiring a task's output into another task's input is what orders the two. |
| `Configuration` | `scope` (dependencies are declared here), `resolvable` (a consumer's view), `consumable` (a variant a module publishes, with attributes and artifacts). |
| `Attribute` | An axis of a variant (`linkage`). The build-wide schema decides compatibility, disambiguation and unification (every edge to one module gets the same value). |
| `Plugin` | `apply(module)`: registers tasks, extensions, configurations. Reacts to other plugins through `plugins.withId`, never through order. |
| Services | Build-wide values: the toolchain, command-line parameters, the C module registry. |

## Plugins

| Plugin | Provides |
|---|---|
| `c` | The `c` block; `implementation` scope; tasks `compile`, `archive`, `linkShared`, `link`, `copyHeaders`, `assemble`. A library publishes a static and a shared variant. Works out inherited C standards and header compatibility on the resolved graph. |
| `clang` | The C toolchain, detected the first time something needs it. |
| `local`, `system`, `git` | Dependency notations. `system` publishes link flags as a variant without a module; `git` checks modules out into `modules/`. |
| `scripts` | `scripts` as tasks `script.<name>`; hooks `preload`, `prebuild`, `postbuild`, `preclean` bound by name. |
| `codegen` | A generator task whose declared outputs become the `c` plugin's generated sources. |
| `shard-json` | Reads `shard.json` into the same config as `shard.ts`. |

## Rules that keep it that way

- No eager configuration: tasks are registered, not created; values are providers.
- A module never changes another module; data crosses modules only through
  consumable configurations.
- A task action sees its own properties, not the module.
- The only data passed between tasks at execution time are files.
