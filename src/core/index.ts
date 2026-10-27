/*
 * The plugin-facing API of the core. The core knows projects, tasks, lazy
 * values and plugins; everything about C, toolchains and dependency sources
 * lives in plugins built on these.
 */
export {
  attribute, AttributeContainer, AttributeSchema,
  type Attribute, type CompatibilityRule, type DisambiguationRule,
} from "./attributes";
export { Build } from "./build";
export {
  Configuration, ConfigurationContainer, projectDependency,
  type Artifact, type ConfigurationRole, type Dependency, type OutgoingVariant,
} from "./configurations";
export { execute, type ExecuteOptions, type ExecutionListener, type ExecutionResult, type TaskOutcome } from "./executor";
export { TaskGraph } from "./graph";
export { extension, ExtensionContainer, PluginContainer, Project, type ExtensionKey, type Plugin, type ProjectInit, type ProjectServices } from "./project";
export { lazy, ListProperty, Property, provider, Provider, type Producer, type ValueOrProvider } from "./provider";
export { ResolutionResult, type ResolutionServices, type ResolvedNode } from "./resolution";
export { Task, type TaskContext, type TaskScope, type TaskType } from "./task";
export { TaskContainer, TaskProvider } from "./tasks";
