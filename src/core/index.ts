/*
 * The plugin-facing API of the core. The core knows modules, tasks, lazy
 * values and plugins; everything about C, toolchains and dependency sources
 * lives in plugins built on these.
 */
export {
  attribute, AttributeContainer, AttributeSchema,
  type Attribute, type CompatibilityRule, type DisambiguationRule,
} from "./attributes";
export { Build } from "./build";
export {
  Configuration, ConfigurationContainer, moduleDependency,
  type Artifact, type ConfigurationRole, type Dependency, type OutgoingVariant,
} from "./configurations";
export { execute, type ExecuteOptions, type ExecutionListener, type ExecutionResult, type TaskOutcome } from "./executor";
export { TaskGraph } from "./graph";
export {
  initialize, PluginRegistry,
  type ConfigContext, type Configurable, type ConfigReader, type DependencyNotation,
  type InitOptions, type ModuleConfig, type NotationHandler, type NotationTarget,
} from "./init";
export { LifecycleTask } from "./lifecycle";
export { extension, ExtensionContainer, PluginContainer, Module, type ExtensionKey, type Plugin, type ModuleInit, type ModuleServices } from "./module";
export { lazy, ListProperty, Property, provider, Provider, type Producer, type ValueOrProvider } from "./provider";
export { SCRIPT_FILE, scriptReader } from "./script";
export { service, ServiceRegistry, type ServiceKey } from "./services";
export { ResolutionResult, type ResolutionOrder, type ResolutionServices, type ResolvedNode } from "./resolution";
export { Task, type TaskContext, type TaskScope, type TaskState, type TaskType } from "./task";
export { TaskContainer, TaskProvider } from "./tasks";
