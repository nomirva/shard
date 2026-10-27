import type { CompileTask, CompilerDriver, DependencyTracker, Invocation } from "../toolchain";
import { compileArgs } from "./flags";

export function clangCompiler(deps: DependencyTracker): CompilerDriver {
  return {
    compile(task: CompileTask, cwd: string): Invocation {
      const args = compileArgs(task.source, task.object, task.options);
      args.push(...deps.compileFlags(task.object));
      return { tool: "clang", args, cwd, io: "stream" };
    },
  };
}
