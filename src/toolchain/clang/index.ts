import { spawnSync } from "child_process";
import { HOST_TARGET, type TargetPlatform } from "../target";
import type { Toolchain, ToolchainProvider } from "../toolchain";
import { depfileTracker } from "../gnu/depfile";
import { platformNaming } from "../naming";
import { clangCompiler } from "./compiler";
import { clangLinker } from "./linker";
import { clangLinkInputs } from "./link-inputs";

const KNOWN_ABIS = ["gnu", "musl", "msvc"] as const;

export const clangProvider: ToolchainProvider = {
  name: "clang",

  detect(): Toolchain | null {
    const r = spawnSync("clang", ["--version"], { stdio: "pipe" });
    if (r.status !== 0) return null;

    const out = (r.stdout?.toString() ?? "") + (r.stderr?.toString() ?? "");
    const lines = out.trim().split("\n");
    const targetLine = lines.find(l => l.trim().startsWith("Target:"));
    const triple = targetLine?.trim().replace(/^Target:\s*/, "") ?? "";
    const target: TargetPlatform = { ...HOST_TARGET, abi: extractAbi(triple) };

    if (process.platform === "win32" && target.abi !== "gnu") return null;
    return createClang(lines[0]?.trim() ?? "unknown", target);
  },
};

export function createClang(version: string, target: TargetPlatform): Toolchain {
  return {
    name: "clang",
    version,
    target,
    naming: platformNaming(target.platform),
    compiler: clangCompiler(depfileTracker),
    linker: clangLinker(target),
    linkInputs: clangLinkInputs(target),
    deps: depfileTracker,
  };
}

function extractAbi(triple: string): string {
  const last = triple.split("-").pop() ?? "";
  return (KNOWN_ABIS as readonly string[]).includes(last) ? last : "none";
}
