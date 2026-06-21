import type { Toolchain } from "./types";
import { ZigToolchain } from "./zig";
import { ClangToolchain } from "./clang";

export function setupToolchain(): Toolchain {
  const clang = new ClangToolchain();
  if (clang.isAvailable()) return clang;

  const zig = new ZigToolchain();
  if (zig.isAvailable()) return zig;

  throw new Error("No supported toolchain found — install Clang or Zig");
}
