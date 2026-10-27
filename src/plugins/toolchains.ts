import { ShardError } from "../utils/errors";
import type { Toolchain, ToolchainProvider } from "./c/toolchain/toolchain";
import { clangProvider } from "./clang/provider";

const providers: ToolchainProvider[] = [clangProvider];

export function registerToolchain(provider: ToolchainProvider): void {
  providers.push(provider);
}

export function listToolchains(): readonly ToolchainProvider[] {
  return providers;
}

export function selectToolchain(): Toolchain {
  for (const provider of providers) {
    const toolchain = provider.detect();
    if (toolchain) return toolchain;
  }
  throw new ShardError(
    "toolchain",
    "No supported toolchain found — install Clang",
    "macOS: brew install llvm · Debian/Ubuntu: sudo apt install clang",
  );
}
