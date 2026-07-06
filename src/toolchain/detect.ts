import type { Toolchain } from "./types";
import { ClangToolchain } from "./clang";

export function setupToolchain(): Toolchain {
  const clang = new ClangToolchain();
  if (clang.isAvailable()) return clang;

  throw new Error("No supported toolchain found — install Clang");
}
