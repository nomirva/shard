import type { ReportEvent } from "./events";

/** The only channel through which pipeline stages talk to the user. */
export interface Reporter {
  emit(event: ReportEvent): void;
}
