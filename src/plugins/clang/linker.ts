import type { TargetPlatform } from "../c/toolchain/target";
import type { ArchiveTask, Invocation, LinkerDriver, LinkTask } from "../c/toolchain/toolchain";
import { subsystemFlags } from "./flags";

export function clangLinker(target: TargetPlatform): LinkerDriver {
  return {
    link(task: LinkTask): Invocation {
      const { libPaths, libFlags, subsystem, extra } = task;
      const args = task.kind === "executable"
        ? [
            ...task.objects,
            ...subsystemFlags(subsystem),
            ...libPaths,
            ...libFlags,
            ...(target.platform === "darwin" ? ["-Wl,-rpath,@executable_path"] : []),
            ...(extra ?? []),
            "-o",
            task.output,
          ]
        : [
            ...subsystemFlags(subsystem),
            "-shared",
            ...task.objects,
            ...libPaths,
            ...libFlags,
            ...(extra ?? []),
            ...(target.platform === "win32"
              ? ["-Wl,--out-implib," + task.output.replace(/\.dll$/, ".lib")]
              : []),
            "-o",
            task.output,
          ];
      return { tool: "clang", args, io: "capture" };
    },

    archive(task: ArchiveTask): Invocation {
      return { tool: "ar", args: ["rcs", task.output, ...task.objects], io: "capture" };
    },
  };
}
