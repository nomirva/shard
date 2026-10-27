import type { ArtifactNaming } from "./toolchain";

export function platformNaming(platform: string): ArtifactNaming {
  return {
    staticLibExt: ".a",
    sharedLibExt: ({ win32: ".dll", darwin: ".dylib", linux: ".so" } as Record<string, string>)[platform] ?? null,
    exeExt: ({ win32: ".exe" } as Record<string, string>)[platform] ?? null,
  };
}
