export enum LinkType {
  Static = "static",
  Shared = "shared",
}

export type WarningSet = "none" | "default" | "extra" | "pedantic" | "all" | "error";
export type Subsystem = "console" | "windows" | "native" | "efi_application";

export type Profile = "debug" | "debug-opt" | "release" | "fast" | "small" | "tiny";

export type CStandard =
  | "c89" | "c99" | "c11" | "c17" | "c23"
  | "gnu89" | "gnu99" | "gnu11" | "gnu17" | "gnu23";

export interface StandardOptions {
  version?: CStandard;
  support?: CStandard;
  pedantic?: boolean | "error";
}
