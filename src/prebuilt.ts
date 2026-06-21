import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { LinkType } from "./types";
import type { Toolchain } from "./toolchain/types";

export interface PrebuiltInfo {
  libPath: string;
  available: LinkType;
  runtimePath?: string;
}

export class Prebuilt {
  static detect(pkgPath: string, pkgName: string, tc: Toolchain, requested?: LinkType): PrebuiltInfo {
    const libDir = join(pkgPath, "lib");
    if (!existsSync(libDir)) {
      throw new Error(`Prebuilt package "${pkgName}" has no lib/ directory`);
    }

    const ext = tc.staticLibExt;
    const sExt = tc.sharedLibExt;
    const iExt = tc.importLibExt;

    const files = readdirSync(libDir);

    const staticCandidates = [
      `${pkgName}${ext}`,
      `lib${pkgName}${ext}`,
    ];
    const sharedCandidates = sExt ? [`${pkgName}${sExt}`] : [];
    const importCandidates = iExt
      ? [
          `${pkgName}${iExt}`,
          `${pkgName}dll${ext}`,
          `lib${pkgName}dll${ext}`,
        ]
      : [];

    const staticFile = staticCandidates.find((f) => files.includes(f));
    const sharedFile = sharedCandidates.find((f) => files.includes(f));
    const importFile = importCandidates.find((f) => files.includes(f));

    const staticAvail = !!staticFile;
    const dynAvail = !!sharedFile;

    if (!staticAvail && !dynAvail) {
      throw new Error(
        `Prebuilt package "${pkgName}" has no supported library file in lib/`
      );
    }

    const useStatic = () => ({
      libPath: join(libDir, staticFile!),
      available: LinkType.Static,
    });

    const useShared = () => ({
      libPath: join(libDir, importFile || sharedFile!),
      available: LinkType.Shared,
      runtimePath: join(libDir, sharedFile!),
    });

    if (staticAvail && !dynAvail) return useStatic();
    if (dynAvail && !staticAvail) return useShared();

    if (requested === LinkType.Shared) return useShared();
    return useStatic();
  }

  static selectBuildType(requested: LinkType | undefined, available: LinkType, pkgName: string): LinkType {
    if (!requested || requested === available) return available;
    process.stderr.write(
      `Warning: "${pkgName}" requested as ${requested} but only ${available} is available, linking ${available}\n`
    );
    return available;
  }
}
