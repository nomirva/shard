import { Command, Option } from "commander";
import pkg from "../../package.json" with { type: "json" };
import { PROFILE_NAMES } from "../plugins/c/lang/profiles";
import { activeConsole } from "./console/session";
import { buildCommand } from "./commands/build";
import { infoCommand } from "./commands/info";
import { updateCommand } from "./commands/update";
import { cleanCommand } from "./commands/clean";
import { runCommand } from "./commands/run";
import { doctorCommand } from "./commands/doctor";

function act(fn: (...args: any[]) => void | Promise<void>): (...args: any[]) => Promise<void> {
  return async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (e: unknown) {
      activeConsole().error(e);
      process.exit(1);
    }
  };
}

export function createProgram(): Command {
  const program = new Command();
  program
    .name("shard")
    .description("C build manager for shard modules")
    .version(pkg.version);

  program
    .command("build")
    .description("Build a shard module")
    .argument("[path]", "Path to the module (default: current directory)", ".")
    .option("--ignore-cache <mode>", "0=cache on (default), 1=ignore root cache, 2=ignore all cache")
    .option("--start", "Build and run the executable")
    .option("--def <names...>", "Pass defines and enable ?define:X conditionals (e.g. --def NODEBUG,VERSION=5)")
    .addOption(new Option("--profile <name>", "Compilation profile (overrides manifest)").choices([...PROFILE_NAMES]))
    .option("--git-protocol <protocol>", "Git protocol: https (default), ssh, or http")
    .option("--verbose", "Show every file, command line and hook output")
    .option("-j, --jobs <n>", "How many tasks run at once (default: one per CPU, or SHARD_JOBS)")
    .action(act(buildCommand));

  program
    .command("info")
    .description("Show module information")
    .argument("<path>", "Path to the module")
    .option("--tree", "Show the whole dependency tree")
    .action(act(infoCommand));

  program
    .command("update")
    .description("Sync modules/ with dependency declarations (install, remove stale, no compilation)")
    .argument("[path]", "Path to the root module (default: current directory)", ".")
    .option("--git-protocol <protocol>", "Git protocol: https (default), ssh, or http")
    .option("--verbose", "Show install paths")
    .action(act(updateCommand));

  program
    .command("clean")
    .description("Remove all build cache and installed dependencies")
    .argument("[path]", "Path to the root module (default: current directory)", ".")
    .action(act(cleanCommand));

  program
    .command("run")
    .description("Run a script from the module manifest")
    .argument("<script>", "Script name from shard.json scripts field")
    .argument("[path]", "Path to the module (default: current directory)", ".")
    .action(act(runCommand));

  program
    .command("doctor")
    .description("Check availability of required toolchain tools")
    .action(() => doctorCommand());

  return program;
}
