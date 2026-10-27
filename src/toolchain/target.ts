export interface TargetPlatform {
  platform: string;
  arch: string;
  abi: string;
}

export const HOST_TARGET: TargetPlatform = {
  platform: process.platform,
  arch: process.arch,
  abi: "none",
};

export function tripleDir(target: TargetPlatform): string {
  return `${target.arch}/${target.platform}/${target.abi}`;
}
